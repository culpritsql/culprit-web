use crate::access::NamedResource;
use serde::Deserialize;
use std::{collections::HashSet, path::PathBuf};
use url::Url;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    public_url: Url,
    archive_name: Option<String>,
    evidence_config: Option<PathBuf>,
    #[serde(default)]
    archives: Vec<ArchiveConfig>,
    auth: AuthConfig,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveConfig {
    pub name: String,
    pub evidence_config: PathBuf,
}

#[derive(Deserialize)]
#[serde(try_from = "ConfigFile")]
pub struct Config {
    pub public_url: Url,
    pub archives: Vec<ArchiveConfig>,
    pub auth: AuthConfig,
}

impl TryFrom<ConfigFile> for Config {
    type Error = &'static str;
    fn try_from(file: ConfigFile) -> Result<Self, Self::Error> {
        let archives = match (file.archive_name, file.evidence_config) {
            (Some(name), Some(evidence_config)) if file.archives.is_empty() => {
                vec![ArchiveConfig {
                    name,
                    evidence_config,
                }]
            }
            (None, None) => file.archives,
            _ => return Err("use archives or a single archive_name and evidence_config pair"),
        };
        let config = Self {
            public_url: file.public_url,
            archives,
            auth: file.auth,
        };
        config.validate()?;
        Ok(config)
    }
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
    pub resources: Option<Vec<NamedResource>>,
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
        let mut archives = HashSet::new();
        for archive in &self.archives {
            if archive.name.trim().is_empty()
                || !archives.insert(archive.name.as_str())
                || archive.evidence_config.as_os_str().is_empty()
            {
                return Err("each archive needs a unique name and an evidence configuration");
            }
        }
        if archives.is_empty() || self.auth.providers.is_empty() || self.auth.grants.is_empty() {
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
                || !archives.contains(grant.archive.as_str())
                || grant.claim.is_empty()
                || grant.value.is_empty()
                || grant.permissions.is_empty()
                || grant.resources.as_ref().is_some_and(|items| {
                    items.is_empty()
                        || items
                            .iter()
                            .any(|r| r.label.trim().is_empty() || r.selector.validate().is_err())
                })
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
        config.auth.grants[0].archive = config.archives[0].name.clone();
        config.auth.grants[0].provider = "unconfigured".into();
        assert!(config.validate().is_err());
    }
}
