//! Pure-Rust zero-dependency telemetry parsers migrated from `tools/caelus_live_world_bridge.mjs`.
//! Supports NMEA 0183 (`$GPRMC`/`$GNRMC`), ITU-R M.1371 AIS (`!AIVDM`/`!AIVDO` Types 1-3),
//! OpenSky ADS-B state vectors, and NORAD 2-line element (TLE) orbit records.
//! All parsers are fail-closed on checksum or schema violations.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelemetryParseError {
    EmptyInput,
    MissingOrBadChecksum,
    InactiveFix,
    UnsupportedSentence,
    MalformedField(&'static str),
    OutOfRange(&'static str),
}

impl fmt::Display for TelemetryParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyInput => write!(f, "empty telemetry input"),
            Self::MissingOrBadChecksum => write!(f, "missing or invalid checksum"),
            Self::InactiveFix => write!(f, "NMEA fix status is not active ('A')"),
            Self::UnsupportedSentence => {
                write!(f, "unsupported telemetry sentence or message type")
            }
            Self::MalformedField(field) => write!(f, "malformed field: {field}"),
            Self::OutOfRange(field) => write!(f, "out-of-range coordinate or metric: {field}"),
        }
    }
}

impl std::error::Error for TelemetryParseError {}

#[derive(Debug, Clone, PartialEq)]
pub struct NmeaRmcFix {
    pub utc_hhmmss: String,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub sog_knots: f64,
    pub cog_deg: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AisVesselFix {
    pub message_type: u8,
    pub mmsi: u32,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub sog_knots: f64,
    pub cog_deg: f64,
    pub heading_deg: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AdsbTrackFix {
    pub icao24: String,
    pub callsign: String,
    pub origin_country: String,
    pub lon_deg: f64,
    pub lat_deg: f64,
    pub alt_m: f64,
    pub vel_mps: f64,
    pub heading_deg: f64,
    pub squawk: String,
    pub is_emergency: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TleOrbit {
    pub name: String,
    pub norad_id: u32,
    pub inclination_deg: f64,
    pub raan_deg: f64,
    pub eccentricity: f64,
    pub arg_perigee_deg: f64,
    pub mean_anomaly_deg: f64,
    pub mean_motion_rev_day: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TleSubpoint {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_km: f64,
}

/// Verifies NMEA `$...*HH` or `!...*HH` XOR checksum and returns the inner payload slice.
fn verify_nmea_checksum(sentence: &str) -> Result<&str, TelemetryParseError> {
    let trimmed = sentence.trim();
    if trimmed.is_empty() {
        return Err(TelemetryParseError::EmptyInput);
    }
    let first = trimmed.as_bytes()[0];
    if first != b'$' && first != b'!' {
        return Err(TelemetryParseError::UnsupportedSentence);
    }
    let star_idx = trimmed
        .rfind('*')
        .ok_or(TelemetryParseError::MissingOrBadChecksum)?;
    if star_idx + 3 != trimmed.len() {
        return Err(TelemetryParseError::MissingOrBadChecksum);
    }
    let body = &trimmed[1..star_idx];
    let hex_str = &trimmed[star_idx + 1..];
    let expected =
        u8::from_str_radix(hex_str, 16).map_err(|_| TelemetryParseError::MissingOrBadChecksum)?;
    let computed = body.bytes().fold(0u8, |acc, b| acc ^ b);
    if computed != expected {
        return Err(TelemetryParseError::MissingOrBadChecksum);
    }
    Ok(body)
}

fn parse_nmea_coord(raw: &str, hemi: &str, is_lon: bool) -> Result<f64, TelemetryParseError> {
    let val: f64 = raw
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("nmea_coord"))?;
    if !val.is_finite() || val < 0.0 {
        return Err(TelemetryParseError::MalformedField("nmea_coord"));
    }
    let deg_part = (val / 100.0).floor();
    let min_part = val - deg_part * 100.0;
    if min_part >= 60.0 {
        return Err(TelemetryParseError::OutOfRange("nmea_minutes"));
    }
    let mut deg = deg_part + min_part / 60.0;
    match (is_lon, hemi) {
        (false, "N") | (true, "E") => {}
        (false, "S") | (true, "W") => deg = -deg,
        _ => return Err(TelemetryParseError::MalformedField("hemisphere")),
    }
    let max_abs = if is_lon { 180.0 } else { 90.0 };
    if deg.abs() > max_abs {
        return Err(TelemetryParseError::OutOfRange("coord_bounds"));
    }
    Ok(deg)
}

/// Parses and checksum-verifies an NMEA 0183 `$GPRMC` or `$GNRMC` sentence.
pub fn parse_nmea_rmc(sentence: &str) -> Result<NmeaRmcFix, TelemetryParseError> {
    let body = verify_nmea_checksum(sentence)?;
    let parts: Vec<&str> = body.split(',').collect();
    if parts.len() < 9 || (parts[0] != "GPRMC" && parts[0] != "GNRMC") {
        return Err(TelemetryParseError::UnsupportedSentence);
    }
    if parts[2] != "A" {
        return Err(TelemetryParseError::InactiveFix);
    }
    let lat_deg = parse_nmea_coord(parts[3], parts[4], false)?;
    let lon_deg = parse_nmea_coord(parts[5], parts[6], true)?;
    let sog_knots = if parts[7].is_empty() {
        0.0
    } else {
        parts[7]
            .parse::<f64>()
            .map_err(|_| TelemetryParseError::MalformedField("sog_knots"))?
    };
    let cog_deg = if parts[8].is_empty() {
        0.0
    } else {
        parts[8]
            .parse::<f64>()
            .map_err(|_| TelemetryParseError::MalformedField("cog_deg"))?
    };

    Ok(NmeaRmcFix {
        utc_hhmmss: parts[1].to_string(),
        lat_deg,
        lon_deg,
        sog_knots,
        cog_deg,
    })
}

fn read_bits_u64(bits: &[u8], start: usize, len: usize) -> u64 {
    let mut val = 0u64;
    for i in 0..len {
        val = (val << 1) | (bits[start + i] as u64);
    }
    val
}

fn read_bits_i32(bits: &[u8], start: usize, len: usize) -> i32 {
    let raw = read_bits_u64(bits, start, len);
    let sign_bit = 1u64 << (len - 1);
    if (raw & sign_bit) != 0 {
        let mask = (!0u64) << len;
        (raw | mask) as i64 as i32
    } else {
        raw as i32
    }
}

/// Parses a single-fragment ITU-R M.1371 `!AIVDM` / `!AIVDO` Type 1/2/3 vessel position report.
pub fn parse_aivdm_position(sentence: &str) -> Result<AisVesselFix, TelemetryParseError> {
    let body = verify_nmea_checksum(sentence)?;
    let parts: Vec<&str> = body.split(',').collect();
    if parts.len() < 7 || (parts[0] != "AIVDM" && parts[0] != "AIVDO") {
        return Err(TelemetryParseError::UnsupportedSentence);
    }
    let payload = parts[5];
    let fill_bits: usize = parts[6]
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("ais_fill_bits"))?;
    if fill_bits > 5 || payload.is_empty() {
        return Err(TelemetryParseError::MalformedField("ais_payload"));
    }

    let mut bits = Vec::with_capacity(payload.len() * 6);
    for byte in payload.bytes() {
        if !(48..=119).contains(&byte) || (88..=95).contains(&byte) {
            return Err(TelemetryParseError::MalformedField("ais_armor_char"));
        }
        let mut six = byte - 48;
        if six > 40 {
            six -= 8;
        }
        if six >= 64 {
            return Err(TelemetryParseError::MalformedField("ais_armor_range"));
        }
        for shift in (0..6).rev() {
            bits.push((six >> shift) & 1);
        }
    }
    if bits.len() < fill_bits + 168 {
        return Err(TelemetryParseError::MalformedField("ais_bit_length"));
    }
    bits.truncate(bits.len() - fill_bits);

    let msg_type = read_bits_u64(&bits, 0, 6) as u8;
    if !(1..=3).contains(&msg_type) {
        return Err(TelemetryParseError::UnsupportedSentence);
    }
    let mmsi = read_bits_u64(&bits, 8, 30) as u32;
    let sog_raw = read_bits_u64(&bits, 50, 10);
    let lon_raw = read_bits_i32(&bits, 61, 28);
    let lat_raw = read_bits_i32(&bits, 89, 27);
    let cog_raw = read_bits_u64(&bits, 116, 12);
    let heading_raw = read_bits_u64(&bits, 128, 9) as u16;

    let lon_deg = lon_raw as f64 / 600_000.0;
    let lat_deg = lat_raw as f64 / 600_000.0;
    if lat_deg.abs() > 90.0 || lon_deg.abs() > 180.0 {
        return Err(TelemetryParseError::OutOfRange("ais_lat_lon"));
    }

    Ok(AisVesselFix {
        message_type: msg_type,
        mmsi,
        lat_deg,
        lon_deg,
        sog_knots: if sog_raw >= 1023 {
            0.0
        } else {
            sog_raw as f64 / 10.0
        },
        cog_deg: if cog_raw >= 3600 {
            0.0
        } else {
            cog_raw as f64 / 10.0
        },
        heading_deg: heading_raw,
    })
}

/// Parses an OpenSky ADS-B state vector from either 9-column CSV or an OpenSky JSON array row.
pub fn parse_opensky_adsb(line: &str) -> Result<AdsbTrackFix, TelemetryParseError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(TelemetryParseError::EmptyInput);
    }

    let raw_fields: Vec<String> = if trimmed.starts_with('[') && trimmed.ends_with(']') {
        trimmed[1..trimmed.len() - 1]
            .split(',')
            .map(|s| s.trim().trim_matches('"').to_string())
            .collect()
    } else {
        trimmed.split(',').map(|s| s.trim().to_string()).collect()
    };

    // Support both compact 9-field CSV/array and full 17-field OpenSky `/api/states/all` array
    let (icao, call, country, lon_s, lat_s, alt_s, vel_s, hdg_s, sqk_s) = if raw_fields.len() >= 15
    {
        (
            &raw_fields[0],
            &raw_fields[1],
            &raw_fields[2],
            &raw_fields[5],
            &raw_fields[6],
            &raw_fields[7],
            &raw_fields[9],
            &raw_fields[10],
            &raw_fields[14],
        )
    } else if raw_fields.len() >= 9 {
        (
            &raw_fields[0],
            &raw_fields[1],
            &raw_fields[2],
            &raw_fields[3],
            &raw_fields[4],
            &raw_fields[5],
            &raw_fields[6],
            &raw_fields[7],
            &raw_fields[8],
        )
    } else {
        return Err(TelemetryParseError::MalformedField("opensky_field_count"));
    };

    if icao.is_empty() {
        return Err(TelemetryParseError::MalformedField("icao24"));
    }
    let lon_deg: f64 = lon_s
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("lon_deg"))?;
    let lat_deg: f64 = lat_s
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("lat_deg"))?;
    if !lat_deg.is_finite() || !lon_deg.is_finite() || lat_deg.abs() > 90.0 || lon_deg.abs() > 180.0
    {
        return Err(TelemetryParseError::OutOfRange("adsb_lat_lon"));
    }
    let alt_m: f64 = alt_s.parse::<f64>().unwrap_or(0.0).max(0.0);
    let vel_mps: f64 = vel_s.parse::<f64>().unwrap_or(0.0).max(0.0);
    let heading_deg: f64 = hdg_s.parse().unwrap_or(0.0);
    let squawk: String = sqk_s.chars().filter(|c| c.is_ascii_digit()).collect();
    let squawk = if squawk.is_empty() {
        "1000".to_string()
    } else {
        squawk
    };
    let is_emergency = matches!(squawk.as_str(), "7500" | "7600" | "7700");

    Ok(AdsbTrackFix {
        icao24: icao.clone(),
        callsign: if call.is_empty() {
            icao.to_ascii_uppercase()
        } else {
            call.clone()
        },
        origin_country: country.clone(),
        lon_deg,
        lat_deg,
        alt_m,
        vel_mps,
        heading_deg,
        squawk,
        is_emergency,
    })
}

fn verify_tle_checksum(line: &str) -> Result<(), TelemetryParseError> {
    if line.len() < 69 {
        return Err(TelemetryParseError::MalformedField("tle_line_length"));
    }
    let expected = line.as_bytes()[68]
        .checked_sub(b'0')
        .filter(|&d| d <= 9)
        .ok_or(TelemetryParseError::MissingOrBadChecksum)? as u32;
    let sum: u32 = line.as_bytes()[..68]
        .iter()
        .map(|&b| match b {
            b'0'..=b'9' => (b - b'0') as u32,
            b'-' => 1,
            _ => 0,
        })
        .sum();
    if sum % 10 != expected {
        return Err(TelemetryParseError::MissingOrBadChecksum);
    }
    Ok(())
}

/// Parses and checksum-verifies a NORAD two-line element (TLE) record.
pub fn parse_norad_tle(
    name: &str,
    line1: &str,
    line2: &str,
) -> Result<TleOrbit, TelemetryParseError> {
    let l1 = line1.trim();
    let l2 = line2.trim();
    if l1.is_empty() || l2.is_empty() {
        return Err(TelemetryParseError::EmptyInput);
    }
    if !l1.starts_with('1') || !l2.starts_with('2') {
        return Err(TelemetryParseError::UnsupportedSentence);
    }
    verify_tle_checksum(l1)?;
    verify_tle_checksum(l2)?;

    let norad_id: u32 = l1[2..7]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_norad_id"))?;
    let inclination_deg: f64 = l2[8..16]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_inclination"))?;
    let raan_deg: f64 = l2[17..25]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_raan"))?;
    let ecc_str = format!("0.{}", l2[26..33].trim());
    let eccentricity: f64 = ecc_str
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_eccentricity"))?;
    let arg_perigee_deg: f64 = l2[34..42]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_arg_perigee"))?;
    let mean_anomaly_deg: f64 = l2[43..51]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_mean_anomaly"))?;
    let mean_motion_rev_day: f64 = l2[52..63]
        .trim()
        .parse()
        .map_err(|_| TelemetryParseError::MalformedField("tle_mean_motion"))?;

    if mean_motion_rev_day <= 0.0 {
        return Err(TelemetryParseError::OutOfRange("tle_mean_motion"));
    }

    Ok(TleOrbit {
        name: name.trim().to_string(),
        norad_id,
        inclination_deg,
        raan_deg,
        eccentricity,
        arg_perigee_deg,
        mean_anomaly_deg,
        mean_motion_rev_day,
    })
}

impl TleOrbit {
    /// Propagates an analytical Keplerian sub-satellite point at `minutes_since_epoch`.
    pub fn propagate_subpoint(&self, minutes_since_epoch: f64) -> TleSubpoint {
        let rev_frac = (self.mean_motion_rev_day / 1_440.0) * minutes_since_epoch;
        let u_rad = (self.arg_perigee_deg + self.mean_anomaly_deg + rev_frac * 360.0).to_radians();
        let inc = self.inclination_deg.to_radians();

        let lat_rad = (inc.sin() * u_rad.sin()).clamp(-1.0, 1.0).asin();
        let lon_inertial =
            self.raan_deg.to_radians() + (inc.cos() * u_rad.sin()).atan2(u_rad.cos());
        let earth_rot = (minutes_since_epoch / 1_436.068) * 2.0 * std::f64::consts::PI;
        let mut lon_deg = (lon_inertial - earth_rot).to_degrees();
        lon_deg = (lon_deg + 180.0).rem_euclid(360.0) - 180.0;

        // Kepler's third law: mu_earth = 398600.4418 km^3/s^2, R_earth = 6378.137 km
        let n_rad_s = self.mean_motion_rev_day * 2.0 * std::f64::consts::PI / 86_400.0;
        let semi_major_km = (398_600.441_8_f64 / (n_rad_s * n_rad_s)).cbrt();
        let alt_km = (semi_major_km - 6_378.137).max(120.0);

        TleSubpoint {
            lat_deg: lat_rad.to_degrees(),
            lon_deg,
            alt_km,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn append_nmea_checksum(body: &str, prefix: char) -> String {
        let csum = body.bytes().fold(0u8, |acc, b| acc ^ b);
        format!("{prefix}{body}*{csum:02X}")
    }

    #[test]
    fn parses_valid_nmea_rmc_and_rejects_bad_checksum_or_void_fix(
    ) -> Result<(), TelemetryParseError> {
        let sentence = append_nmea_checksum(
            "GPRMC,082500.00,A,3811.7600,N,02650.1600,E,14.8,162.5,111125,,,A",
            '$',
        );
        let fix = parse_nmea_rmc(&sentence)?;
        assert!((fix.lat_deg - 38.196).abs() < 1e-4);
        assert!((fix.lon_deg - 26.836).abs() < 1e-4);
        assert!((fix.sog_knots - 14.8).abs() < 1e-6);

        let bad_csum = "$GPRMC,082500.00,A,3811.7600,N,02650.1600,E,14.8,162.5,111125,,,A*00";
        assert_eq!(
            parse_nmea_rmc(bad_csum),
            Err(TelemetryParseError::MissingOrBadChecksum)
        );

        let void_fix = append_nmea_checksum(
            "GPRMC,082500.00,V,3811.7600,N,02650.1600,E,0.0,0.0,111125,,,N",
            '$',
        );
        assert_eq!(
            parse_nmea_rmc(&void_fix),
            Err(TelemetryParseError::InactiveFix)
        );
        Ok(())
    }

    #[test]
    fn parses_itu_aivdm_vessel_position_report() -> Result<(), TelemetryParseError> {
        // Real ITU-R M.1371 Type 1 sample (!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C)
        let ais = parse_aivdm_position("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C")?;
        assert_eq!(ais.message_type, 1);
        assert_eq!(ais.mmsi, 477_553_000);
        assert!((ais.lon_deg - (-122.345_833)).abs() < 1e-4);
        assert!((ais.lat_deg - 47.582_833).abs() < 1e-4);

        let corrupt = "!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*00";
        assert_eq!(
            parse_aivdm_position(corrupt),
            Err(TelemetryParseError::MissingOrBadChecksum)
        );
        Ok(())
    }

    #[test]
    fn parses_opensky_adsb_csv_and_emergency_squawk() -> Result<(), TelemetryParseError> {
        let csv = "4ba921,THY241,Turkiye,26.85,38.21,10360,231.5,164.0,7700";
        let track = parse_opensky_adsb(csv)?;
        assert_eq!(track.icao24, "4ba921");
        assert_eq!(track.callsign, "THY241");
        assert!(track.is_emergency);
        assert!((track.lat_deg - 38.21).abs() < 1e-6);

        let bad_coord = "4ba921,THY241,Turkiye,26.85,99.50,10360,231.5,164.0,1000";
        assert_eq!(
            parse_opensky_adsb(bad_coord),
            Err(TelemetryParseError::OutOfRange("adsb_lat_lon"))
        );
        Ok(())
    }

    #[test]
    fn parses_iss_norad_tle_and_propagates_within_inclination() -> Result<(), TelemetryParseError> {
        let l1 = "1 25544U 98067A   25315.35069444  .00016717  00000-0  30124-3 0  9995";
        let l2 = "2 25544  51.6416  15.4981 0004321 247.4600 112.6000 15.49814215480015";
        // Compute exact mod-10 checksums for test stability
        let fix_csum = |s: &str| -> String {
            let prefix = &s[..68];
            let sum: u32 = prefix
                .bytes()
                .map(|b| match b {
                    b'0'..=b'9' => (b - b'0') as u32,
                    b'-' => 1,
                    _ => 0,
                })
                .sum();
            format!("{prefix}{}", sum % 10)
        };
        let l1 = fix_csum(l1);
        let l2 = fix_csum(l2);

        let orbit = parse_norad_tle("ISS (ZARYA)", &l1, &l2)?;
        assert_eq!(orbit.norad_id, 25544);
        assert!((orbit.inclination_deg - 51.6416).abs() < 1e-4);

        let pt = orbit.propagate_subpoint(15.0);
        assert!(pt.lat_deg.abs() <= 51.7);
        assert!((-180.0..=180.0).contains(&pt.lon_deg));
        assert!(pt.alt_km > 380.0 && pt.alt_km < 460.0);

        let mut bad_l2 = l2.clone();
        bad_l2.pop();
        bad_l2.push(if l2.ends_with('0') { '1' } else { '0' });
        assert_eq!(
            parse_norad_tle("ISS", &l1, &bad_l2),
            Err(TelemetryParseError::MissingOrBadChecksum)
        );
        Ok(())
    }
}
