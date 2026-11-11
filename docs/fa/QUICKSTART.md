---
title: شروع سریع
description: از اولین اسکن تا افزودن Offing به CI، در پنج گام.
layout: doc
lang: fa
---

# شروع سریع

این صفحه مسیر شروع کار با Offing را گام‌به‌گام نشان می‌دهد. دستورها را همان‌طور که نوشته شده‌اند اجرا کنید؛ خروجی نمونه پس از هر مرحله آمده است. پیش‌نیاز: Node.js نسخهٔ ۲۲ یا جدیدتر.

## ۱. اجرای اولین اسکن

نیازی به نصب نیست. در ریشهٔ مخزن خود اجرا کنید:

```bash
npx @velella/offing scan .
```

خروجی، یک خط برای هر یافته با شدت، مکان دقیق فایل و جایگزین پیشنهادی است. برای خروجی ماشین‌خوان <bdi><code>--json</code></bdi> و برای یک خط خلاصه به‌ازای هر یافته <bdi><code>--format compact</code></bdi> را اضافه کنید. اگر مخزن تمیز باشد:

```text
No lifecycle risks found.
```

## ۲. بررسی یک وابستگی پیش از افزودن

یک بسته یا اکشن را با Package URL بررسی کنید، بدون اسکن مخزن:

```bash
npx @velella/offing check pkg:npm/request@2.88.2
npx @velella/offing check pkg:github/actions/checkout@v4
```

پاسخ <bdi><code>no-data</code></bdi> یعنی Offing قاعده‌ای برای این بسته ندارد، نه اینکه سالم است. اگر نسخه را ندهید، <bdi><code>version-dependent</code></bdi> نشان می‌دهد که نتیجه به نسخه بستگی دارد.

## ۳. دیدن شواهد و مسیر مهاجرت

شناسهٔ یک یافته را از خروجی مرحلهٔ ۱ بردارید و جزئیاتش را ببینید:

```bash
npx @velella/offing explain '<finding-id>' .
```

برای دادن زمینهٔ ساختاریافته به یک ایجنت کدنویس:

```bash
npx @velella/offing context '<finding-id>' . --json
```

بستهٔ مهاجرت شامل قیدها و مراحل مخصوص قاعده، فایل‌ها و استفاده‌های دقیق متأثر، منابع معتبر و دستورهای تأیید پیشنهادی است. Offing هرگز آن دستورها را خودکار اجرا نمی‌کند.

## ۴. افزودن به CI

اکشن را در یک workflow قرار دهید تا هر pull request بررسی شود:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7
  - uses: velella-sh/offing@v0.7.1
    with:
      fail-on-severity: high
```

برای مدل تهدید خود می‌توانید به‌جای تگ نسخه، SHA کامل کامیت را پین کنید. راهنمای کامل در [GitHub Action](../GITHUB_ACTION.md) است.

## ۵. ساختن baseline

یافته‌های موجود و پذیرفته‌شده را ثبت کنید تا گزارش‌های بعدی فقط پس‌رفت‌های جدید را نشان دهند:

```bash
npx @velella/offing baseline .
npx @velella/offing scan . --baseline .offing-baseline.json
```

فایل baseline را در مخزن کامیت کنید. یافته‌های baseline به‌طور پیش‌فرض پنهان می‌شوند و با <bdi><code>--on-expired resurface</code></bdi> دوباره ظاهر می‌شوند.

## قدم بعدی

- [خانهٔ فارسی](index.md)
- [مرجع CLI](../CLI.md)
- [ماتریس سازگاری](../COMPATIBILITY.md)
- [راهنمای MCP محلی](../MCP.md)
- [Agent Skill](../AGENT_SKILLS.md)
