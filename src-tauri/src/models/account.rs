use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAccount {
    pub id: String,
    pub username: String,
    pub skin_path: Option<String>,
    pub owns_java: bool,
    pub session_state: SessionState,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Active,
    Expired,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    pub account: PublicAccount,
    pub microsoft_refresh_token: String,
    pub minecraft_access_token: String,
    pub minecraft_expires_at: i64,
    pub updated_at: i64,
}

impl StoredAccount {
    pub fn minecraft_token_expired(&self, now: i64, leeway_seconds: i64) -> bool {
        self.minecraft_expires_at <= now.saturating_add(leeway_seconds)
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccounts {
    pub active_account_id: Option<String>,
    pub accounts: Vec<StoredAccount>,
}

impl StoredAccounts {
    pub fn active(&self) -> Option<&StoredAccount> {
        let active_id = self.active_account_id.as_deref()?;
        self.accounts
            .iter()
            .find(|account| account.account.id == active_id)
    }

    pub fn set_active(&mut self, account: StoredAccount) {
        let id = account.account.id.clone();
        if let Some(existing) = self
            .accounts
            .iter_mut()
            .find(|existing| existing.account.id == id)
        {
            *existing = account;
        } else {
            self.accounts.push(account);
        }
        self.active_account_id = Some(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_account(expires_at: i64) -> StoredAccount {
        StoredAccount {
            account: PublicAccount {
                id: "abc123".into(),
                username: "RealPlayer".into(),
                skin_path: Some("skins/abc123.png".into()),
                owns_java: true,
                session_state: SessionState::Active,
            },
            microsoft_refresh_token: "refresh-secret".into(),
            minecraft_access_token: "minecraft-secret".into(),
            minecraft_expires_at: expires_at,
            updated_at: 1_000,
        }
    }

    #[test]
    fn token_expiration_honors_leeway() {
        let account = sample_account(1_200);
        assert!(!account.minecraft_token_expired(1_000, 60));
        assert!(account.minecraft_token_expired(1_150, 60));
    }

    #[test]
    fn public_account_serialization_contains_no_tokens() {
        let account = sample_account(1_200);
        let json = serde_json::to_string(&account.account).unwrap();
        assert!(json.contains("RealPlayer"));
        assert!(!json.contains("refresh-secret"));
        assert!(!json.contains("minecraft-secret"));
    }
}
