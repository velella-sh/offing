---
title: "Lifecycle lookup"
description: "Search and filter Offing's reviewed lifecycle rules by ecosystem, event, and status."
layout: doc
permalink: /lookup/
---

# Lifecycle lookup

Search and filter Offing's reviewed lifecycle rules from `registry/*.json`. Every row links to its rule page with affected versions, dates, authoritative sources, and migration notes.

::data-explorer{from="rules" columns='[{"field":"title","label":"Rule"},{"field":"ecosystem","label":"Ecosystem"},{"field":"event","label":"Event"},{"field":"status","label":"Status"},{"field":"severity","label":"Severity"},{"field":"deadline","label":"Date","kind":"date"},{"field":"replacement","label":"Replacement"}]' filters="ecosystem,event,status" sort="title,ecosystem,deadline"}
