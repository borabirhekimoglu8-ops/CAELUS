//! Kurtenbach 8-way radial Marking Menu geometry and action mapping.

use crate::theme::Vec2f;
use caelus_core::domain::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RadialSector {
    NorthMaritimeAis = 0,
    NorthEastAirAdsb = 1,
    EastSpaceTle = 2,
    SouthEastCrisis = 3,
    SouthDealLens = 4,
    SouthWestHubLens = 5,
    WestTogglePierB = 6,
    NorthWestToggleTheme = 7,
}

impl RadialSector {
    /// All 8 sectors ordered clockwise starting from North (`-PI/2` screen angle).
    pub const ALL: [RadialSector; 8] = [
        RadialSector::NorthMaritimeAis,
        RadialSector::NorthEastAirAdsb,
        RadialSector::EastSpaceTle,
        RadialSector::SouthEastCrisis,
        RadialSector::SouthDealLens,
        RadialSector::SouthWestHubLens,
        RadialSector::WestTogglePierB,
        RadialSector::NorthWestToggleTheme,
    ];

    /// Clockwise index `0..8`.
    pub fn index(self) -> usize {
        self as usize
    }

    /// Screen-space angle in radians (`0` = East, `-PI/2` = North).
    pub fn screen_angle_rad(self) -> f32 {
        (self.index() as f32) * (std::f32::consts::PI / 4.0) - std::f32::consts::FRAC_PI_2
    }

    /// Concise localized radial label.
    pub fn label(self, locale: Locale) -> &'static str {
        match (self, locale) {
            (Self::NorthMaritimeAis, Locale::Tr) => "DENIZ / AIS",
            (Self::NorthMaritimeAis, Locale::En) => "SEA / AIS",
            (Self::NorthEastAirAdsb, Locale::Tr) => "HAVA / ADS-B",
            (Self::NorthEastAirAdsb, Locale::En) => "AIR / ADS-B",
            (Self::EastSpaceTle, Locale::Tr) => "UZAY / TLE",
            (Self::EastSpaceTle, Locale::En) => "SPACE / TLE",
            (Self::SouthEastCrisis, Locale::Tr) => "KRIZ / SINIR",
            (Self::SouthEastCrisis, Locale::En) => "CRISIS",
            (Self::SouthDealLens, Locale::Tr) => "02 ANLASMA",
            (Self::SouthDealLens, Locale::En) => "02 DEAL",
            (Self::SouthWestHubLens, Locale::Tr) => "03 HUB",
            (Self::SouthWestHubLens, Locale::En) => "03 HUB",
            (Self::WestTogglePierB, Locale::Tr) => "ISKELE B",
            (Self::WestTogglePierB, Locale::En) => "PIER B",
            (Self::NorthWestToggleTheme, Locale::Tr) => "GECE / GUN",
            (Self::NorthWestToggleTheme, Locale::En) => "DAY / NIGHT",
        }
    }
}

/// Resolves pointer offset `delta` from the radial center into one of 8 sectors outside the deadzone.
pub fn resolve_radial_sector(delta: Vec2f, deadzone_px: f32) -> Option<RadialSector> {
    if delta.length() < deadzone_px {
        return None;
    }
    // Clockwise angle from North (0 = North, 90 = East, 180 = South, 270 = West)
    let angle_deg = delta.x.atan2(-delta.y).to_degrees().rem_euclid(360.0);
    let idx = (((angle_deg + 22.5) / 45.0).floor() as usize) % 8;
    Some(RadialSector::ALL[idx])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_all_eight_sectors_and_deadzone() {
        assert_eq!(resolve_radial_sector(Vec2f::new(6.0, -6.0), 24.0), None);
        assert_eq!(
            resolve_radial_sector(Vec2f::new(0.0, -60.0), 24.0),
            Some(RadialSector::NorthMaritimeAis)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(50.0, -50.0), 24.0),
            Some(RadialSector::NorthEastAirAdsb)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(60.0, 0.0), 24.0),
            Some(RadialSector::EastSpaceTle)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(50.0, 50.0), 24.0),
            Some(RadialSector::SouthEastCrisis)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(0.0, 60.0), 24.0),
            Some(RadialSector::SouthDealLens)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(-50.0, 50.0), 24.0),
            Some(RadialSector::SouthWestHubLens)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(-60.0, 0.0), 24.0),
            Some(RadialSector::WestTogglePierB)
        );
        assert_eq!(
            resolve_radial_sector(Vec2f::new(-50.0, -50.0), 24.0),
            Some(RadialSector::NorthWestToggleTheme)
        );
    }
}
