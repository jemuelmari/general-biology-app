# Google Apps Script Backend — Setup Guide

**Version:** 1.2.0
**Purpose:** Enable cross-device sync codes for the General Biology App

---

## 📋 What This Does

Deploys a Google Apps Script backend that:
- Stores **Sync Codes** so they work across devices
- Records **student scores** and **progress** in a Google Sheet
- Powers the **teacher's "Sync Center"** to import student data from anywhere

Without this backend, Sync Codes only work if student and teacher use the **same device**.

---

## 🚀 Setup Steps (One-Time, ~10 Minutes)

### 1. Create a Google Sheet

1. Go to https://sheets.google.com
2. Create a new blank spreadsheet
3. Name it: `GeneralBiologyApp_Backend`

### 2. Open Apps Script

In the sheet: **Extensions → Apps Script**

### 3. Paste the Code

1. Delete the default `function myFunction() {}` stub
2. Paste the entire contents of `Code.gs`
3. Save (Ctrl+S)
4. Rename the project to: `GeneralBiologyApp-Backend`

### 4. Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon → **Web app**
3. Configure:
   - **Description:** `GeneralBiologyApp v1.2.0`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. Authorize when prompted
6. **Copy the Web App URL** (looks like):
