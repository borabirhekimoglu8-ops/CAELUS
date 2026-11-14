//! 7-language Zero-Jargon Dictionary (`tr, en, el, fr, de, es, ru`)
//! and One-Way Glass Wall promotion stages (`Kisisel -> Kulucka -> Saha`).

use crate::domain::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale7 {
    Tr,
    En,
    El,
    Fr,
    De,
    Es,
    Ru,
}

impl Locale7 {
    pub const ALL: [Locale7; 7] = [
        Locale7::Tr,
        Locale7::En,
        Locale7::El,
        Locale7::Fr,
        Locale7::De,
        Locale7::Es,
        Locale7::Ru,
    ];

    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Tr => "TR",
            Self::En => "EN",
            Self::El => "EL",
            Self::Fr => "FR",
            Self::De => "DE",
            Self::Es => "ES",
            Self::Ru => "RU",
        }
    }

    #[must_use]
    pub const fn next(self) -> Self {
        match self {
            Self::Tr => Self::En,
            Self::En => Self::El,
            Self::El => Self::Fr,
            Self::Fr => Self::De,
            Self::De => Self::Es,
            Self::Es => Self::Ru,
            Self::Ru => Self::Tr,
        }
    }

    #[must_use]
    pub const fn to_core_locale(self) -> Locale {
        match self {
            Self::Tr => Locale::Tr,
            _ => Locale::En,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlassWallStage {
    PersonalWorkspace,
    IncubationShelf,
    FieldMission,
}

impl GlassWallStage {
    /// Strictly one-way promotion (`Personal -> Incubation -> Field`). Never demotes automatically.
    #[must_use]
    pub const fn promote_one_way(self) -> Self {
        match self {
            Self::PersonalWorkspace => Self::IncubationShelf,
            Self::IncubationShelf | Self::FieldMission => Self::FieldMission,
        }
    }

    #[must_use]
    pub const fn label(self, locale: Locale7) -> &'static str {
        match (self, locale) {
            (Self::PersonalWorkspace, Locale7::Tr) => "Kisisel Calisma Alani",
            (Self::IncubationShelf, Locale7::Tr) => "Kulucka Rafi",
            (Self::FieldMission, Locale7::Tr) => "Saha Gorevi",
            (Self::PersonalWorkspace, Locale7::En) => "Personal Workspace",
            (Self::IncubationShelf, Locale7::En) => "Incubation Shelf",
            (Self::FieldMission, Locale7::En) => "Field Mission",
            (Self::PersonalWorkspace, Locale7::El) => "Prosopikos Choros",
            (Self::IncubationShelf, Locale7::El) => "Rafi Epokoasis",
            (Self::FieldMission, Locale7::El) => "Apostoli Pediou",
            (Self::PersonalWorkspace, Locale7::Fr) => "Espace Personnel",
            (Self::IncubationShelf, Locale7::Fr) => "Rayon Incubation",
            (Self::FieldMission, Locale7::Fr) => "Mission Terrain",
            (Self::PersonalWorkspace, Locale7::De) => "Eigener Bereich",
            (Self::IncubationShelf, Locale7::De) => "Brutregal",
            (Self::FieldMission, Locale7::De) => "Feldeinsatz",
            (Self::PersonalWorkspace, Locale7::Es) => "Espacio Personal",
            (Self::IncubationShelf, Locale7::Es) => "Estante Incubacion",
            (Self::FieldMission, Locale7::Es) => "Mision Campo",
            (Self::PersonalWorkspace, Locale7::Ru) => "Lichny Kabinet",
            (Self::IncubationShelf, Locale7::Ru) => "Polka Inkubatsii",
            (Self::FieldMission, Locale7::Ru) => "Polevaya Missiya",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiPhrase {
    AppHeader,
    SentinelWarning,
    SentinelCalm,
    GlassWallTitle,
    HandoverSummary,
}

#[must_use]
pub const fn phrase(key: UiPhrase, locale: Locale7) -> &'static str {
    match (key, locale) {
        (UiPhrase::AppHeader, Locale7::Tr) => "CAELUS EGE DENIZ KOMUTA",
        (UiPhrase::AppHeader, Locale7::En) => "CAELUS AEGEAN COMMAND",
        (UiPhrase::AppHeader, Locale7::El) => "CAELUS AIGAIO DIOIKISI",
        (UiPhrase::AppHeader, Locale7::Fr) => "CAELUS EGEE COMMANDE",
        (UiPhrase::AppHeader, Locale7::De) => "CAELUS AGAIS KOMMANDO",
        (UiPhrase::AppHeader, Locale7::Es) => "CAELUS EGEO MANDO",
        (UiPhrase::AppHeader, Locale7::Ru) => "CAELUS EGEISKOE UPRAVLENIE",

        (UiPhrase::SentinelWarning, Locale7::Tr) => "OTONOM NOBETCI: AKTIF RISK",
        (UiPhrase::SentinelWarning, Locale7::En) => "SENTINEL: ACTIVE RISK",
        (UiPhrase::SentinelWarning, Locale7::El) => "FROUROS: ENERGOS KINDYNOS",
        (UiPhrase::SentinelWarning, Locale7::Fr) => "SENTINELLE: RISQUE ACTIF",
        (UiPhrase::SentinelWarning, Locale7::De) => "WACHTER: AKTIVES RISIKO",
        (UiPhrase::SentinelWarning, Locale7::Es) => "CENTINELA: RIESGO ACTIVO",
        (UiPhrase::SentinelWarning, Locale7::Ru) => "STRAZH: AKTIVNY RISK",

        (UiPhrase::SentinelCalm, Locale7::Tr) => "OTONOM NOBETCI: NOMINAL",
        (UiPhrase::SentinelCalm, Locale7::En) => "SENTINEL: NOMINAL",
        (UiPhrase::SentinelCalm, Locale7::El) => "FROUROS: OMALOS",
        (UiPhrase::SentinelCalm, Locale7::Fr) => "SENTINELLE: NOMINAL",
        (UiPhrase::SentinelCalm, Locale7::De) => "WACHTER: NOMINAL",
        (UiPhrase::SentinelCalm, Locale7::Es) => "CENTINELA: NOMINAL",
        (UiPhrase::SentinelCalm, Locale7::Ru) => "STRAZH: NORMA",

        (UiPhrase::GlassWallTitle, Locale7::Tr) => "Tek Yonlu Cam Duvar",
        (UiPhrase::GlassWallTitle, Locale7::En) => "One-Way Glass Wall",
        (UiPhrase::GlassWallTitle, Locale7::El) => "Monodromos Gyalinos Toichos",
        (UiPhrase::GlassWallTitle, Locale7::Fr) => "Paroi Verre Sens Unique",
        (UiPhrase::GlassWallTitle, Locale7::De) => "Einweg-Glaswand",
        (UiPhrase::GlassWallTitle, Locale7::Es) => "Muro Cristal Unidireccional",
        (UiPhrase::GlassWallTitle, Locale7::Ru) => "Odnostoronnyaya Stena",

        (UiPhrase::HandoverSummary, Locale7::Tr) => "60sn Vardiya Devir Ozeti",
        (UiPhrase::HandoverSummary, Locale7::En) => "60s Shift Handover Summary",
        (UiPhrase::HandoverSummary, Locale7::El) => "Perilipsi Bardias 60d",
        (UiPhrase::HandoverSummary, Locale7::Fr) => "Resume Releve 60s",
        (UiPhrase::HandoverSummary, Locale7::De) => "60s Schichtubergabe",
        (UiPhrase::HandoverSummary, Locale7::Es) => "Resumen Relevo 60s",
        (UiPhrase::HandoverSummary, Locale7::Ru) => "60s Svodka Smeny",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_seven_locales_have_non_empty_zero_em_dash_phrases() {
        let keys = [
            UiPhrase::AppHeader,
            UiPhrase::SentinelWarning,
            UiPhrase::SentinelCalm,
            UiPhrase::GlassWallTitle,
            UiPhrase::HandoverSummary,
        ];
        for loc in Locale7::ALL {
            for k in keys {
                let p = phrase(k, loc);
                assert!(!p.is_empty());
                assert!(!p.contains('\u{2014}'));
            }
            for stage in [
                GlassWallStage::PersonalWorkspace,
                GlassWallStage::IncubationShelf,
                GlassWallStage::FieldMission,
            ] {
                let s = stage.label(loc);
                assert!(!s.is_empty());
                assert!(!s.contains('\u{2014}'));
            }
        }
    }

    #[test]
    fn glass_wall_promotion_is_strictly_one_way() {
        let s0 = GlassWallStage::PersonalWorkspace;
        let s1 = s0.promote_one_way();
        let s2 = s1.promote_one_way();
        let s3 = s2.promote_one_way();
        assert_eq!(s1, GlassWallStage::IncubationShelf);
        assert_eq!(s2, GlassWallStage::FieldMission);
        assert_eq!(s3, GlassWallStage::FieldMission);
    }
}
