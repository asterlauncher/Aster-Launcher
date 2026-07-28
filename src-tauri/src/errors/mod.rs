use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("Microsoft authentication is not configured")]
    Configuration,
    #[error("The Microsoft sign-in was cancelled")]
    LoginCancelled,
    #[error("Microsoft did not return to the launcher in time")]
    CallbackTimeout,
    #[error("The Microsoft sign-in response could not be trusted")]
    InvalidOAuthState,
    #[error("Microsoft authentication failed")]
    MicrosoftAuthentication,
    #[error("Xbox authentication failed")]
    XboxAuthentication,
    #[error("Xbox security token authentication failed")]
    XstsAuthentication,
    #[error("Minecraft Services authentication failed")]
    MinecraftAuthentication,
    #[error("This Xbox account is restricted from completing sign-in")]
    AccountRestricted,
    #[error("Minecraft Java Edition is not owned by this account")]
    MinecraftNotOwned,
    #[error("The Minecraft profile is unavailable")]
    MinecraftProfileUnavailable,
    #[error("The saved account session has expired")]
    SessionExpired,
    #[error("The saved account session could not be refreshed")]
    TokenRefreshFailed,
    #[error("No internet connection is available")]
    Offline,
    #[error("The Minecraft skin could not be downloaded")]
    SkinDownloadFailed,
    #[error("Secure account storage is unavailable")]
    SecureStorage,
    #[error("The local sign-in callback could not be started")]
    CallbackListener,
    #[error("An internal authentication error occurred")]
    Internal,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthErrorPayload {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<AuthError> for AuthErrorPayload {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::Configuration => Self {
                code: "configuration",
                message: "Microsoft sign-in is not configured yet.",
            },
            AuthError::LoginCancelled => Self {
                code: "login_cancelled",
                message: "Microsoft sign-in was cancelled.",
            },
            AuthError::CallbackTimeout => Self {
                code: "callback_timeout",
                message: "Microsoft did not return to the launcher in time. Please try again.",
            },
            AuthError::InvalidOAuthState => Self {
                code: "invalid_oauth_state",
                message: "The sign-in response could not be verified. Please try again.",
            },
            AuthError::MicrosoftAuthentication => Self {
                code: "microsoft_authentication_failed",
                message: "Microsoft authentication failed. Please try again.",
            },
            AuthError::XboxAuthentication => Self {
                code: "xbox_authentication_failed",
                message: "Xbox authentication failed for this Microsoft account.",
            },
            AuthError::XstsAuthentication => Self {
                code: "xsts_authentication_failed",
                message: "Xbox security authentication failed for this account.",
            },
            AuthError::MinecraftAuthentication => Self {
                code: "minecraft_authentication_failed",
                message: "Minecraft Services rejected this launcher registration or account session.",
            },
            AuthError::AccountRestricted => Self {
                code: "account_restricted",
                message: "This account cannot use Xbox services because of its privacy, age, or family settings.",
            },
            AuthError::MinecraftNotOwned => Self {
                code: "minecraft_not_owned",
                message: "This Microsoft account does not own Minecraft Java Edition.",
            },
            AuthError::MinecraftProfileUnavailable => Self {
                code: "minecraft_profile_unavailable",
                message: "Minecraft could not provide a Java profile for this account.",
            },
            AuthError::SessionExpired => Self {
                code: "session_expired",
                message: "Your Microsoft session has expired. Please sign in again.",
            },
            AuthError::TokenRefreshFailed => Self {
                code: "token_refresh_failed",
                message: "The saved Microsoft session could not be refreshed. Please sign in again.",
            },
            AuthError::Offline => Self {
                code: "offline",
                message: "The launcher could not reach Microsoft or Minecraft services.",
            },
            AuthError::SkinDownloadFailed => Self {
                code: "skin_download_failed",
                message: "Your account is signed in, but the active skin could not be downloaded.",
            },
            AuthError::SecureStorage => Self {
                code: "secure_storage_failed",
                message: "Windows secure account storage is unavailable.",
            },
            AuthError::CallbackListener => Self {
                code: "callback_listener_failed",
                message: "The launcher could not start the local Microsoft sign-in callback.",
            },
            AuthError::Internal => Self {
                code: "internal",
                message: "An internal authentication error occurred.",
            },
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn redact_sensitive(input: &str) -> String {
    const SENSITIVE_MARKERS: [&str; 8] = [
        "access_token",
        "refresh_token",
        "authorization",
        "identitytoken",
        "rpsticket",
        "xsts",
        "cookie",
        "code=",
    ];

    input
        .lines()
        .map(|line| {
            let lowercase = line.to_ascii_lowercase();
            if SENSITIVE_MARKERS
                .iter()
                .any(|marker| lowercase.contains(marker))
            {
                "[REDACTED]".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_map_to_safe_public_messages() {
        let payload = AuthErrorPayload::from(AuthError::MinecraftNotOwned);
        assert_eq!(payload.code, "minecraft_not_owned");
        assert!(!payload.message.contains("token"));
    }

    #[test]
    fn sensitive_values_are_redacted() {
        let source = "operation=refresh\naccess_token=super-secret\nstatus=401";
        let redacted = redact_sensitive(source);
        assert!(redacted.contains("operation=refresh"));
        assert!(redacted.contains("status=401"));
        assert!(!redacted.contains("super-secret"));
    }
}
