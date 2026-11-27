use crate::config::{Grant, Permission};
use culprit_core::PublishedResourceSelector;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NamedResource {
    pub label: String,
    pub selector: PublishedResourceSelector,
}

#[derive(Clone, Serialize)]
pub struct AssignedResource {
    #[serde(flatten)]
    pub resource: NamedResource,
    pub inspect_evidence: bool,
    pub export_evidence: bool,
}

#[derive(Clone, Default, Serialize)]
pub struct ArchiveAccess {
    pub view_fleet: bool,
    pub inspect_evidence: bool,
    pub export_evidence: bool,
    pub resources: Vec<AssignedResource>,
}

impl ArchiveAccess {
    fn include(&mut self, grant: &Grant) {
        let inspect = grant.permissions.contains(&Permission::InspectEvidence);
        let export = grant.permissions.contains(&Permission::ExportEvidence);
        let Some(resources) = &grant.resources else {
            self.view_fleet |= inspect || grant.permissions.contains(&Permission::ViewReports);
            self.inspect_evidence |= inspect;
            self.export_evidence |= export;
            return;
        };
        for resource in resources {
            if let Some(existing) = self
                .resources
                .iter_mut()
                .find(|entry| entry.resource.selector == resource.selector)
            {
                existing.inspect_evidence |= inspect;
                existing.export_evidence |= export;
            } else {
                self.resources.push(AssignedResource {
                    resource: resource.clone(),
                    inspect_evidence: inspect,
                    export_evidence: export,
                });
            }
        }
    }

    pub fn may_inspect(&self, resource: &PublishedResourceSelector) -> bool {
        self.inspect_evidence
            || self
                .resources
                .iter()
                .any(|entry| entry.inspect_evidence && entry.resource.selector == *resource)
    }

    pub fn may_export(&self, resource: &PublishedResourceSelector) -> bool {
        self.may_inspect(resource)
            && (self.export_evidence
                || self
                    .resources
                    .iter()
                    .any(|entry| entry.export_evidence && entry.resource.selector == *resource))
    }

    pub fn has_inspection_grant(&self) -> bool {
        self.inspect_evidence || self.resources.iter().any(|entry| entry.inspect_evidence)
    }
}

#[derive(Clone)]
pub struct Actor {
    pub issuer: String,
    pub subject: String,
}

#[derive(Clone, Serialize)]
pub struct Access {
    #[serde(skip)]
    pub actor: Actor,
    pub archives: BTreeMap<String, ArchiveAccess>,
}

impl Access {
    pub fn from_claims(
        provider: &str,
        actor: Actor,
        claims: &BTreeMap<String, Value>,
        grants: &[Grant],
    ) -> Option<Self> {
        let mut archives = BTreeMap::<String, ArchiveAccess>::new();
        for grant in grants.iter().filter(|grant| grant.provider == provider) {
            let Some(value) = claims.get(&grant.claim) else {
                continue;
            };
            let matches = value.as_str() == Some(&grant.value)
                || value.as_array().is_some_and(|values| {
                    values
                        .iter()
                        .any(|value| value.as_str() == Some(&grant.value))
                });
            if matches {
                archives
                    .entry(grant.archive.clone())
                    .or_default()
                    .include(grant);
            }
        }
        (!archives.is_empty()).then_some(Self { actor, archives })
    }
}
