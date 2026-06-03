# luci-base APK 8-byte delta investigation

**Question:** Why is `luci-base` 8 bytes larger in `jsmin` vs `without_PR_package_manager`, when the only code change is in `package-manager.js`?

**Answer:** `package-manager.js` is not in `luci-base` — it ships in `luci-app-package-manager`. The 8-byte difference comes from `version.uc`, which embeds the git branch name:

| Variant | branch in version.uc |
|---------|---------------------|
| jsmin | `LuCI test-minifier-switch branch` |
| without_PR | `LuCI Master` |

The 21-character plaintext difference deflates to 8 bytes in the compressed APK. No other files differ between the two APKs (identical 140-file listing).

## Files compared

| Variant | APK Path | Size |
|---------|----------|------|
| jsmin | `build-artifacts_jsmin/packages/mipsel_24kc/luci/luci-base-26.099.44769~4a308ba.apk` | 159,594 B |
| without_PR | `build-artifacts_without_PR_package_manager/packages/mipsel_24kc/luci/luci-base-26.099.44769~4a308ba.apk` | 159,586 B |
