#!/usr/bin/env bash
# CAELUS — git geçmişi temizliği (repo sahibi tarafından, main üzerinde koşulur)
#
# NE YAPAR: Geçmişe gömülü üretilmiş artefact'ları (≈16k satır/4.5k dosya:
# target/ ağaçları, build_cmake/, build_tests/, __pycache__, 3.3 MB audit log)
# ve — en önemlisi — bir dönem düz metin commit'lenmiş ESKİ imzalama tohumunu
# (tools/caelus_signing.key) TÜM geçmişten söker. Eski tohumun pubkey'i
# 2026-07-02 anahtar töreniyle zaten döndürüldü (docs/ANAHTAR_TORENI_*.md);
# bu temizlik, sızmış tohumun git geçmişinden dahi kazınmasını tamamlar ve
# klon boyutunu ciddi küçültür.
#
# NEDEN AYRI SCRIPT: Geçmiş yeniden yazımı YIKICIDIR (tüm commit SHA'ları
# değişir, açık PR'lar kopar, mevcut klonlar yeniden klonlanmalıdır) ve force
# push gerektirir. Bu karar ve yürütme repo sahibine aittir; CI/ajan branch'i
# üzerinden yapılamaz.
#
# KULLANIM (temiz bir dizinde):
#   pip install git-filter-repo
#   git clone --no-local <repo-url> caelus-rewrite && cd caelus-rewrite
#   bash tools/purge_git_history.sh          # yerelde yeniden yazar
#   # sonucu inceleyin (git log --stat, du -sh .git), sonra:
#   git push --force --all origin
#   git push --force --tags origin
#   # tüm ekip üyeleri: eski klonları SİLİP yeniden klonlar.
set -euo pipefail

command -v git-filter-repo >/dev/null 2>&1 || {
    echo "HATA: git-filter-repo gerekli (pip install git-filter-repo)" >&2
    exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
    echo "HATA: çalışma ağacı temiz değil; taze bir klonda koşun." >&2
    exit 1
fi

echo "Yeniden yazım öncesi boyut: $(du -sh .git | cut -f1)"

git filter-repo \
    --invert-paths \
    --path tools/caelus_signing.key \
    --path caelus_audit_0000000000000000.log \
    --path target/ \
    --path caelus_core/target/ \
    --path build_cmake/ \
    --path build_tests/ \
    --path tools/__pycache__/ \
    --path tests/__pycache__/

echo "Yeniden yazım sonrası boyut: $(du -sh .git | cut -f1)"
echo
echo "Şimdi sonucu inceleyin; memnunsanız:"
echo "  git push --force --all origin && git push --force --tags origin"
echo "ve tüm klonların yeniden alınmasını sağlayın."
