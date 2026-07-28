use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::errors::AuthError;

const XBOX_USER_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";

pub struct XboxToken {
    pub token: String,
    pub user_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct XboxUserRequest<'a> {
    relying_party: &'static str,
    token_type: &'static str,
    properties: XboxUserProperties<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct XboxUserProperties<'a> {
    auth_method: &'static str,
    site_name: &'static str,
    rps_ticket: String,
    #[serde(skip)]
    _access_token: std::marker::PhantomData<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct XstsRequest<'a> {
    relying_party: &'static str,
    token_type: &'static str,
    properties: XstsProperties<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct XstsProperties<'a> {
    sandbox_id: &'static str,
    user_tokens: [&'a str; 1],
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XboxTokenResponse {
    token: String,
    display_claims: DisplayClaims,
}

#[derive(Deserialize)]
struct DisplayClaims {
    xui: Vec<UserClaim>,
}

#[derive(Deserialize)]
struct UserClaim {
    uhs: String,
}

#[derive(Deserialize)]
struct XstsError {
    #[serde(rename = "XErr")]
    xerr: Option<u64>,
}

pub async fn authenticate_user(
    client: &Client,
    microsoft_access_token: &str,
) -> Result<XboxToken, AuthError> {
    let request = XboxUserRequest {
        relying_party: "http://auth.xboxlive.com",
        token_type: "JWT",
        properties: XboxUserProperties {
            auth_method: "RPS",
            site_name: "user.auth.xboxlive.com",
            rps_ticket: format!("d={microsoft_access_token}"),
            _access_token: std::marker::PhantomData,
        },
    };

    let response = client
        .post(XBOX_USER_AUTH_URL)
        .timeout(Duration::from_secs(20))
        .header("x-xbl-contract-version", "1")
        .json(&request)
        .send()
        .await
        .map_err(map_network_error)?;

    parse_token(response, AuthError::XboxAuthentication).await
}

pub async fn authorize_xsts(
    client: &Client,
    xbox_user_token: &str,
) -> Result<XboxToken, AuthError> {
    let request = XstsRequest {
        relying_party: "rp://api.minecraftservices.com/",
        token_type: "JWT",
        properties: XstsProperties {
            sandbox_id: "RETAIL",
            user_tokens: [xbox_user_token],
        },
    };

    let response = client
        .post(XSTS_AUTH_URL)
        .timeout(Duration::from_secs(20))
        .header("x-xbl-contract-version", "1")
        .json(&request)
        .send()
        .await
        .map_err(map_network_error)?;

    if !response.status().is_success() {
        let error_code = response
            .json::<XstsError>()
            .await
            .ok()
            .and_then(|payload| payload.xerr);
        return Err(match error_code {
            Some(2_148_916_233 | 2_148_916_235 | 2_148_916_236 | 2_148_916_237 | 2_148_916_238) => {
                AuthError::AccountRestricted
            }
            _ => AuthError::XstsAuthentication,
        });
    }

    parse_successful_token(response, AuthError::XstsAuthentication).await
}

async fn parse_token(
    response: reqwest::Response,
    failure: AuthError,
) -> Result<XboxToken, AuthError> {
    if !response.status().is_success() {
        return Err(failure);
    }
    parse_successful_token(response, failure).await
}

async fn parse_successful_token(
    response: reqwest::Response,
    failure: AuthError,
) -> Result<XboxToken, AuthError> {
    let payload = response
        .json::<XboxTokenResponse>()
        .await
        .map_err(|_| failure)?;
    let user_hash = payload
        .display_claims
        .xui
        .first()
        .map(|claim| claim.uhs.clone())
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::XboxAuthentication)?;
    if payload.token.is_empty() {
        return Err(AuthError::XboxAuthentication);
    }

    Ok(XboxToken {
        token: payload.token,
        user_hash,
    })
}

fn map_network_error(error: reqwest::Error) -> AuthError {
    if error.is_connect() || error.is_timeout() {
        AuthError::Offline
    } else {
        AuthError::XboxAuthentication
    }
}
