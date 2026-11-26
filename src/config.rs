use serde::Deserialize;
use std::{collections::HashSet, path::PathBuf};
use url::Url;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub public_url: Url,
    pub archive_name: String,
    pub evidence_config: PathBuf,
    pub auth: AuthConfig,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthConfig {
    pub providers: Vec<Provider>,
    pub grants: Vec<Grant>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub issuer: String,
    pub client_id: String,
    pub client_secret_file: PathBuf,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub provider: String,
    pub archive: String,
    pub claim: String,
    pub value: String,
    pub permissions: Vec<Permission>,
}

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ViewReports,
    InspectEvidence,
}

fn secure_endpoint(url: &Url) -> bool {
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    (url.scheme() == "https" || (url.scheme() == "http" && local))
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

impl Config {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !secure_endpoint(&self.public_url) || self.public_url.path() != "/" {
            return Err(
                "public_url must be an HTTPS origin (HTTP loopback is supported for development)",
            );
        }
        if self.archive_name.trim().is_empty()
            || self.auth.providers.is_empty()
            || self.auth.grants.is_empty()
        {
            return Err(
                "configure a named archive, an identity provider and an explicit access grant",
            );
        }
        let mut ids = HashSet::new();
        for p in &self.auth.providers {
            if p.id.is_empty()
                || !p.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                || !ids.insert(&p.id)
                || p.label.trim().is_empty()
                || p.client_id.trim().is_empty()
                || !Url::parse(&p.issuer).is_ok_and(|url| secure_endpoint(&url))
            {
                return Err("invalid or duplicate OIDC provider");
            }
        }
        for grant in &self.auth.grants {
            if !ids.contains(&grant.provider)
                || grant.archive != self.archive_name
                || grant.claim.is_empty()
                || grant.value.is_empty()
                || grant.permissions.is_empty()
            {
                return Err("access grant must match a configured provider and archive");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use culprit_archive_web::ArchiveWebApp;
    use culprit_engine::evidence::EvidenceConfig;

    #[test]
    fn shipped_archive_configs_produce_distinct_revision_bound_connections() {
        let reference = |file| {
            let archive = EvidenceConfig::from_file(file).unwrap();
            ArchiveWebApp::connection_info_from_config("production", &archive)
                .unwrap()
                .reference
        };
        let clickhouse = reference(std::path::Path::new("config/archive.example.json"));
        let adx = reference(std::path::Path::new("config/archive.azure.example.json"));
        assert_eq!(adx.name, clickhouse.name);
        assert_ne!(adx.revision, clickhouse.revision);
    }

    #[test]
    fn grants_are_bound_to_a_configured_archive_and_provider() {
        let mut config: Config =
            serde_json::from_str(include_str!("../config/web.example.json")).unwrap();
        assert!(config.validate().is_ok());
        config.auth.grants[0].archive = "unconfigured".into();
        assert!(config.validate().is_err());
        config.auth.grants[0].archive = config.archive_name.clone();
        config.auth.grants[0].provider = "unconfigured".into();
        assert!(config.validate().is_err());
    }
}
