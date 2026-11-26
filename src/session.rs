use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 4096;

/// Single-replica, expiring server-side state. Random identifiers are the only browser credentials.
pub struct Expiring<T>(Mutex<HashMap<String, (Instant, T)>>);

impl<T> Default for Expiring<T> {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

impl<T> Expiring<T> {
    pub fn insert(&self, key: String, value: T, ttl: Duration) -> bool {
        let now = Instant::now();
        let mut values = self.0.lock().expect("session lock");
        values.retain(|_, (until, _)| *until > now);
        if values.len() >= MAX_ENTRIES {
            return false;
        }
        values.insert(key, (now + ttl, value));
        true
    }
    pub fn take(&self, key: &str) -> Option<T> {
        self.0
            .lock()
            .expect("session lock")
            .remove(key)
            .filter(|(until, _)| *until > Instant::now())
            .map(|(_, value)| value)
    }
    pub fn get(&self, key: &str) -> Option<T>
    where
        T: Clone,
    {
        self.0
            .lock()
            .expect("session lock")
            .get(key)
            .filter(|(until, _)| *until > Instant::now())
            .map(|(_, value)| value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pending_flow_is_consumed_once_and_an_expired_session_cannot_be_read() {
        let state = Expiring::default();
        assert!(state.insert("flow".into(), 1, Duration::from_secs(30)));
        assert_eq!(state.take("flow"), Some(1));
        assert_eq!(state.take("flow"), None);
        assert!(state.insert("session".into(), 2, Duration::ZERO));
        assert_eq!(state.get("session"), None);
        assert_eq!(state.take("session"), None);
    }
}
