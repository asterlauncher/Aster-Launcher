use std::time::Duration;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    task::JoinHandle,
    time::timeout,
};
use url::Url;

use crate::{errors::AuthError, models::auth::CallbackPayload};

const CALLBACK_PATH: &str = "/auth/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

pub struct CallbackSession {
    pub redirect_uri: String,
    pub receiver: oneshot::Receiver<Result<CallbackPayload, AuthError>>,
    pub task: JoinHandle<()>,
}

pub async fn start_callback_listener() -> Result<CallbackSession, AuthError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| AuthError::CallbackListener)?;
    let port = listener
        .local_addr()
        .map_err(|_| AuthError::CallbackListener)?
        .port();
    // Microsoft treats loopback ports as dynamic for native applications. The
    // listener remains bound to IPv4 loopback, while `localhost` matches the
    // redirect URI registered in Entra.
    let redirect_uri = format!("http://localhost:{port}{CALLBACK_PATH}");
    let (sender, receiver) = oneshot::channel();

    let task = tokio::spawn(async move {
        let result = match timeout(CALLBACK_TIMEOUT, receive_callback(listener)).await {
            Ok(result) => result,
            Err(_) => Err(AuthError::CallbackTimeout),
        };
        let _ = sender.send(result);
    });

    Ok(CallbackSession {
        redirect_uri,
        receiver,
        task,
    })
}

async fn receive_callback(listener: TcpListener) -> Result<CallbackPayload, AuthError> {
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|_| AuthError::CallbackListener)?;
    let mut request = vec![0_u8; 16 * 1024];
    let bytes_read = timeout(Duration::from_secs(10), stream.read(&mut request))
        .await
        .map_err(|_| AuthError::CallbackTimeout)?
        .map_err(|_| AuthError::CallbackListener)?;
    request.truncate(bytes_read);

    let result = std::str::from_utf8(&request)
        .map_err(|_| AuthError::MicrosoftAuthentication)
        .and_then(parse_callback_request);

    let (status, title, copy) = match &result {
        Ok(_) => (
            "200 OK",
            "Sign-in complete",
            "You can close this browser window and return to Aster Launcher.",
        ),
        Err(AuthError::LoginCancelled) => (
            "200 OK",
            "Sign-in cancelled",
            "No account changes were made. You can return to Aster Launcher.",
        ),
        Err(_) => (
            "400 Bad Request",
            "Sign-in could not be completed",
            "Return to Aster Launcher and try again.",
        ),
    };
    let html = callback_html(title, copy);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;

    result
}

fn parse_callback_request(request: &str) -> Result<CallbackPayload, AuthError> {
    let request_line = request
        .lines()
        .next()
        .ok_or(AuthError::MicrosoftAuthentication)?;
    let target = request_line
        .split_whitespace()
        .nth(1)
        .ok_or(AuthError::MicrosoftAuthentication)?;
    parse_callback_target(target)
}

pub(crate) fn parse_callback_target(target: &str) -> Result<CallbackPayload, AuthError> {
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| AuthError::MicrosoftAuthentication)?;
    if url.path() != CALLBACK_PATH {
        return Err(AuthError::MicrosoftAuthentication);
    }

    let mut code = None;
    let mut state = None;
    let mut oauth_error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => oauth_error = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error) = oauth_error {
        return Err(if error == "access_denied" {
            AuthError::LoginCancelled
        } else {
            AuthError::MicrosoftAuthentication
        });
    }

    Ok(CallbackPayload {
        code: code
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::MicrosoftAuthentication)?,
        state: state
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::InvalidOAuthState)?,
    })
}

fn callback_html(title: &str, copy: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><style>body{{margin:0;background:#0e0c11;color:#eee;font:16px system-ui;display:grid;min-height:100vh;place-items:center}}main{{max-width:460px;padding:34px;border:1px solid #332b3d;border-radius:16px;background:#19151e;text-align:center}}h1{{font-size:24px}}p{{color:#aaa1b3;line-height:1.5}}</style></head><body><main><h1>{title}</h1><p>{copy}</p></main></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_query_is_parsed_and_decoded() {
        let payload = parse_callback_target("/auth/callback?code=a%2Fb&state=state-123").unwrap();
        assert_eq!(payload.code, "a/b");
        assert_eq!(payload.state, "state-123");
    }

    #[test]
    fn cancelled_callback_maps_to_cancelled_error() {
        assert!(matches!(
            parse_callback_target("/auth/callback?error=access_denied&state=a"),
            Err(AuthError::LoginCancelled)
        ));
    }
}
