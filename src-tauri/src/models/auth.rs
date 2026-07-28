use serde::{Deserialize, Serialize};

use super::account::PublicAccount;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStart {
    pub request_id: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProgress {
    pub stage: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthStatusState {
    SignedOut,
    Authenticating,
    Authenticated,
    Expired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub state: AuthStatusState,
    pub account: Option<PublicAccount>,
}

#[derive(Debug)]
pub struct CallbackPayload {
    pub code: String,
    pub state: String,
}
