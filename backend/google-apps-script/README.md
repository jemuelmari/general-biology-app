# Google Apps Script Backend — Setup Guide

**Version:** 1.0.0
**Purpose:** Cross-device sync for the General Biology Online Modular Application

---

## 📋 What This Does

The backend stores and retrieves student data via a Google Sheet:

| Sheet | Purpose |
|---|---|
| **Records** | Every progress save and score submission |
| **SyncCodes** | Sync codes students generate for teacher import |
| **SyncLog** | Audit log of backend actions |

Students send data via `POST`; teachers fetch data via `GET` or by resolving sync codes.

---

## 🚀 Setup Steps

### 1. Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it something like `GeneralBiologyApp_Backend`

### 2. Open Apps Script

1. In the Google Sheet: **Extensions → Apps Script**
2. This opens the Apps Script editor

### 3. Paste the Code

1. Delete the default `function myFunction() {}` stub
2. Paste the entire contents of `Code.gs`
3. Save (Ctrl+S / Cmd+S)
4. Name the project: `GeneralBiologyApp-Backend`

### 4. Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon → select **Web app**
3. Configure:
   - **Description:** `GeneralBiologyApp v1.0.0`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. Authorize the app (grant permissions)
6. **Copy the Web App URL** — it looks like:
