use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::errors::AuthError;

const AUTHORIZE_ENDPOINT: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBOX_SCOPES: &str = "XboxLive.signin XboxLive.offline_access";

pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

pub struct MicrosoftTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct MicrosoftTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Deserialize)]
struct MicrosoftErrorResponse {
    error: Option<String>,
}

pub fn generate_pkce() -> Result<PkcePair, AuthError> {
    let verifier = random_urlsafe(64)?;
    let digest = Sha256::digest(verifier.as_bytes());
    Ok(PkcePair {
        verifier,
        challenge: URL_SAFE_NO_PAD.encode(digest),
    })
}

pub fn generate_state() -> Result<String, AuthError> {
    random_urlsafe(32)
}

pub fn validate_state(expected: &str, returned: &str) -> Result<(), AuthError> {
    let expected = expected.as_bytes();
    let returned = returned.as_bytes();
    if expected.len() != returned.len() {
        return Err(AuthError::InvalidOAuthState);
    }

    let difference = expected
        .iter()
        .zip(returned)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        });

    if difference == 0 {
        Ok(())
    } else {
        Err(AuthError::InvalidOAuthState)
    }
}

pub fn authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    pkce_challenge: &str,
) -> Result<String, AuthError> {
    let mut url = Url::parse(AUTHORIZE_ENDPOINT).map_err(|_| AuthError::Internal)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", XBOX_SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", pkce_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    Ok(url.into())
}

pub async fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<MicrosoftTokens, AuthError> {
    let response = client
        .post(TOKEN_ENDPOINT)
        .timeout(Duration::from_secs(20))
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
            ("scope", XBOX_SCOPES),
        ])
        .send()
        .await
        .map_err(map_network_error)?;

    parse_token_response(response, None, false).await
}

pub async fn refresh_access_token(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<MicrosoftTokens, AuthError> {
    let response = client
        .post(TOKEN_ENDPOINT)
        .timeout(Duration::from_secs(20))
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", XBOX_SCOPES),
        ])
        .send()
        .await
        .map_err(map_network_error)?;

    parse_token_response(response, Some(refresh_token), true).await
}

async fn parse_token_response(
    response: reqwest::Response,
    existing_refresh_token: Option<&str>,
    refreshing: bool,
) -> Result<MicrosoftTokens, AuthError> {
    if !response.status().is_success() {
        let error_code = response
            .json::<MicrosoftErrorResponse>()
            .await
            .ok()
            .and_then(|payload| payload.error);

        if refreshing && matches!(error_code.as_deref(), Some("invalid_grant")) {
            return Err(AuthError::SessionExpired);
        }
        return Err(if refreshing {
            AuthError::TokenRefreshFailed
        } else {
            AuthError::MicrosoftAuthentication
        });
    }

    let payload = response
        .json::<MicrosoftTokenResponse>()
        .await
        .map_err(|_| AuthError::MicrosoftAuthentication)?;
    if payload.access_token.is_empty() || payload.expires_in <= 0 {
        return Err(AuthError::MicrosoftAuthentication);
    }

    let refresh_token = payload
        .refresh_token
        .or_else(|| existing_refresh_token.map(ToOwned::to_owned))
        .filter(|token| !token.is_empty())
        .ok_or(if refreshing {
            AuthError::TokenRefreshFailed
        } else {
            AuthError::MicrosoftAuthentication
        })?;

    Ok(MicrosoftTokens {
        access_token: payload.access_token,
        refresh_token,
    })
}

fn random_urlsafe(byte_length: usize) -> Result<String, AuthError> {
    let mut bytes = vec![0_u8; byte_length];
    getrandom::fill(&mut bytes).map_err(|_| AuthError::Internal)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn map_network_error(error: reqwest::Error) -> AuthError {
    if error.is_connect() || error.is_timeout() {
        AuthError::Offline
    } else {
        AuthError::MicrosoftAuthentication
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_is_url_safe_and_uses_sha256() {
        let pair = generate_pkce().unwrap();
        assert!(pair.verifier.len() >= 43);
        assert!(!pair.verifier.contains('='));
        let digest = Sha256::digest(pair.verifier.as_bytes());
        assert_eq!(pair.challenge, URL_SAFE_NO_PAD.encode(digest));
    }

    #[test]
    fn state_is_random_and_validates_in_constant_shape() {
        let first = generate_state().unwrap();
        let second = generate_state().unwrap();
        assert_ne!(first, second);
        assert!(validate_state(&first, &first).is_ok());
        assert!(matches!(
            validate_state(&first, &second),
            Err(AuthError::InvalidOAuthState)
        ));
    }
}
