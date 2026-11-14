//! Serde decimal ASCII string helpers for 64-bit integers crossing JSON / MCP boundaries
//! (CAELUS Axiom 2: avoids JS Number 2^53 - 1 precision loss).

use serde::{Deserialize, Deserializer, Serializer};

pub mod i64_str {
    use super::*;

    pub fn serialize<S>(val: &i64, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        ser.serialize_str(&val.to_string())
    }

    pub fn deserialize<'de, D>(de: D) -> Result<i64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(de)?;
        s.parse::<i64>().map_err(serde::de::Error::custom)
    }
}

pub mod u64_str {
    use super::*;

    pub fn serialize<S>(val: &u64, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        ser.serialize_str(&val.to_string())
    }

    pub fn deserialize<'de, D>(de: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(de)?;
        s.parse::<u64>().map_err(serde::de::Error::custom)
    }
}

pub mod opt_i64_str {
    use super::*;

    pub fn serialize<S>(val: &Option<i64>, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match val {
            Some(v) => ser.serialize_some(&v.to_string()),
            None => ser.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(de: D) -> Result<Option<i64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt = Option::<String>::deserialize(de)?;
        match opt {
            Some(s) => s.parse::<i64>().map(Some).map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}
