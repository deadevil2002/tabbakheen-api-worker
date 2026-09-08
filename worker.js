"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // worker.js
  (() => {
    var __defProp2 = Object.defineProperty;
    var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
    var FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
    var EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
    var TOKEN_URL = "https://oauth2.googleapis.com/token";
    function base64url(buffer) {
      const bytes = new Uint8Array(buffer);
      let str = "";
      for (const b of bytes) str += String.fromCharCode(b);
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    __name(base64url, "base64url");
    __name2(base64url, "base64url");
    function base64urlStr(str) {
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    __name(base64urlStr, "base64urlStr");
    __name2(base64urlStr, "base64urlStr");
    async function importPrivateKey(pem) {
      const cleaned = pem.replace(/\\n/g, "\n").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
      const binaryDer = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
      return crypto.subtle.importKey(
        "pkcs8",
        binaryDer.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
    }
    __name(importPrivateKey, "importPrivateKey");
    __name2(importPrivateKey, "importPrivateKey");
    async function createJWT(clientEmail, privateKey) {
      const now = Math.floor(Date.now() / 1e3);
      const header = { alg: "RS256", typ: "JWT" };
      const payload = {
        iss: clientEmail,
        sub: clientEmail,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
        scope: "https://www.googleapis.com/auth/datastore"
      };
      const encodedHeader = base64urlStr(JSON.stringify(header));
      const encodedPayload = base64urlStr(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const key = await importPrivateKey(privateKey);
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(signingInput)
      );
      return `${signingInput}.${base64url(signature)}`;
    }
    __name(createJWT, "createJWT");
    __name2(createJWT, "createJWT");
    async function getAccessToken(clientEmail, privateKey) {
      const jwt = await createJWT(clientEmail, privateKey);
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${text}`);
      }
      const data = await response.json();
      return data.access_token;
    }
    __name(getAccessToken, "getAccessToken");
    __name2(getAccessToken, "getAccessToken");
    function parseFirestoreValue(value) {
      if (!value) return null;
      if ("stringValue" in value) return value.stringValue;
      if ("integerValue" in value) return parseInt(value.integerValue, 10);
      if ("doubleValue" in value) return value.doubleValue;
      if ("booleanValue" in value) return value.booleanValue;
      if ("nullValue" in value) return null;
      if ("timestampValue" in value) return value.timestampValue;
      if ("mapValue" in value && value.mapValue.fields) {
        const result = {};
        for (const [k, v] of Object.entries(value.mapValue.fields)) {
          result[k] = parseFirestoreValue(v);
        }
        return result;
      }
      if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(parseFirestoreValue);
      }
      return null;
    }
    __name(parseFirestoreValue, "parseFirestoreValue");
    __name2(parseFirestoreValue, "parseFirestoreValue");
    function parseFirestoreDoc(doc) {
      if (!doc || !doc.fields) return null;
      const result = {};
      for (const [key, value] of Object.entries(doc.fields)) {
        result[key] = parseFirestoreValue(value);
      }
      if (doc.name) {
        const parts = doc.name.split("/");
        result._id = parts[parts.length - 1];
      }
      return result;
    }
    __name(parseFirestoreDoc, "parseFirestoreDoc");
    __name2(parseFirestoreDoc, "parseFirestoreDoc");
    async function getFirestoreDoc(collection, docId, accessToken) {
      const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        if (response.status === 404) return null;
        const text = await response.text();
        throw new Error(`Firestore GET ${collection}/${docId} failed: ${response.status} ${text}`);
      }
      const doc = await response.json();
      return parseFirestoreDoc(doc);
    }
    __name(getFirestoreDoc, "getFirestoreDoc");
    __name2(getFirestoreDoc, "getFirestoreDoc");
    async function queryFirestore(collectionId, fieldPath, op, value, accessToken) {
      const url = `${FIRESTORE_BASE}:runQuery`;
      let firestoreValue;
      if (value === null) firestoreValue = { nullValue: null };
      else if (typeof value === "string") firestoreValue = { stringValue: value };
      else if (typeof value === "number") firestoreValue = { integerValue: String(value) };
      else if (typeof value === "boolean") firestoreValue = { booleanValue: value };
      else firestoreValue = { stringValue: String(value) };
      const body = {
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath },
              op,
              value: firestoreValue
            }
          }
        }
      };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firestore query failed: ${response.status} ${text}`);
      }
      const results = await response.json();
      return results.filter((r) => r.document).map((r) => parseFirestoreDoc(r.document));
    }
    __name(queryFirestore, "queryFirestore");
    __name2(queryFirestore, "queryFirestore");
    function toFirestoreValue(value) {
      if (value === null || value === void 0) return { nullValue: null };
      if (typeof value === "string") return { stringValue: value };
      if (typeof value === "number") {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
      }
      if (typeof value === "boolean") return { booleanValue: value };
      if (typeof value === "object" && !Array.isArray(value)) {
        const fields = {};
        for (const [k, v] of Object.entries(value)) {
          fields[k] = toFirestoreValue(v);
        }
        return { mapValue: { fields } };
      }
      if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(toFirestoreValue) } };
      }
      return { stringValue: String(value) };
    }
    __name(toFirestoreValue, "toFirestoreValue");
    __name2(toFirestoreValue, "toFirestoreValue");
    async function listAllUsers(accessToken) {
      const users = [];
      let pageToken = null;
      do {
        let url = `${FIRESTORE_BASE}/users?pageSize=300`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to list users: ${response.status} ${text}`);
        }
        const data = await response.json();
        if (data.documents) {
          for (const doc of data.documents) {
            const parsed = parseFirestoreDoc(doc);
            if (parsed) users.push(parsed);
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
      return users;
    }
    __name(listAllUsers, "listAllUsers");
    __name2(listAllUsers, "listAllUsers");
    async function listAllOrders(accessToken) {
      const orders = [];
      let pageToken = null;
      do {
        let url = `${FIRESTORE_BASE}/orders?pageSize=300`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to list orders: ${response.status} ${text}`);
        }
        const data = await response.json();
        if (data.documents) {
          for (const doc of data.documents) {
            const parsed = parseFirestoreDoc(doc);
            if (parsed) orders.push(parsed);
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
      return orders;
    }
    __name(listAllOrders, "listAllOrders");
    __name2(listAllOrders, "listAllOrders");
    async function listAllOffers(accessToken) {
      const offers = [];
      let pageToken = null;
      do {
        let url = `${FIRESTORE_BASE}/offers?pageSize=300`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to list offers: ${response.status} ${text}`);
        }
        const data = await response.json();
        if (data.documents) {
          for (const doc of data.documents) {
            const parsed = parseFirestoreDoc(doc);
            if (parsed) offers.push(parsed);
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
      return offers;
    }
    __name(listAllOffers, "listAllOffers");
    __name2(listAllOffers, "listAllOffers");
    async function listAllComplaints(accessToken) {
      const complaints = [];
      let pageToken = null;
      do {
        let url = `${FIRESTORE_BASE}/delivery_complaints?pageSize=300`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          if (response.status === 404) return [];
          const text = await response.text();
          throw new Error(`Failed to list complaints: ${response.status} ${text}`);
        }
        const data = await response.json();
        if (data.documents) {
          for (const doc of data.documents) {
            const parsed = parseFirestoreDoc(doc);
            if (parsed) complaints.push(parsed);
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
      return complaints;
    }
    __name(listAllComplaints, "listAllComplaints");
    __name2(listAllComplaints, "listAllComplaints");
    async function listAllInvoices(accessToken) {
      const invoices = [];
      let pageToken = null;
      do {
        let url = `${FIRESTORE_BASE}/invoices?pageSize=300`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          if (response.status === 404) return [];
          const text = await response.text();
          throw new Error(`Failed to list invoices: ${response.status} ${text}`);
        }
        const data = await response.json();
        if (data.documents) {
          for (const doc of data.documents) {
            const parsed = parseFirestoreDoc(doc);
            if (parsed) invoices.push(parsed);
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
      return invoices;
    }
    __name(listAllInvoices, "listAllInvoices");
    __name2(listAllInvoices, "listAllInvoices");
    async function updateFirestoreDocument(collectionPath, docId, fields, accessToken) {
      const fieldPaths = Object.keys(fields);
      const maskParams = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
      const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}?${maskParams}`;
      const firestoreFields = {};
      for (const [key, value] of Object.entries(fields)) {
        firestoreFields[key] = toFirestoreValue(value);
      }
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: firestoreFields })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firestore PATCH ${collectionPath}/${docId} failed: ${response.status} ${text}`);
      }
      return await response.json();
    }
    __name(updateFirestoreDocument, "updateFirestoreDocument");
    __name2(updateFirestoreDocument, "updateFirestoreDocument");
    async function createFirestoreDocument(collectionPath, docId, fields, accessToken) {
      const url = docId ? `${FIRESTORE_BASE}/${collectionPath}/${docId}` : `${FIRESTORE_BASE}/${collectionPath}`;
      const firestoreFields = {};
      for (const [key, value] of Object.entries(fields)) {
        firestoreFields[key] = toFirestoreValue(value);
      }
      const method = docId ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: firestoreFields })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firestore CREATE ${collectionPath} failed: ${response.status} ${text}`);
      }
      return await response.json();
    }
    __name(createFirestoreDocument, "createFirestoreDocument");
    __name2(createFirestoreDocument, "createFirestoreDocument");
    async function deleteFirestoreDocument(collectionPath, docId, accessToken) {
      const url = `${FIRESTORE_BASE}/${collectionPath}/${docId}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (!response.ok && response.status !== 404) {
        const text = await response.text();
        throw new Error(`Firestore DELETE ${collectionPath}/${docId} failed: ${response.status} ${text}`);
      }
      return true;
    }
    __name(deleteFirestoreDocument, "deleteFirestoreDocument");
    __name2(deleteFirestoreDocument, "deleteFirestoreDocument");
    async function sha1Hex(str) {
      const data = new TextEncoder().encode(str);
      const hash = await crypto.subtle.digest("SHA-1", data);
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(sha1Hex, "sha1Hex");
    __name2(sha1Hex, "sha1Hex");
    async function uploadToCloudinary(imageBase64, folder, env) {
      const cloudName = env.CLOUDINARY_CLOUD_NAME || "dv6n9vnly";
      const apiKey = env.CLOUDINARY_API_KEY;
      const apiSecret = env.CLOUDINARY_API_SECRET;
      if (!apiKey || !apiSecret) {
        throw new Error("Cloudinary API credentials not configured. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET as Worker secrets.");
      }
      const timestamp = String(Math.floor(Date.now() / 1e3));
      const params = { folder, timestamp };
      const sortedStr = Object.keys(params).sort().map((k) => k + "=" + params[k]).join("&");
      const signature = await sha1Hex(sortedStr + apiSecret);
      const formData = new FormData();
      formData.append("file", imageBase64);
      formData.append("api_key", apiKey);
      formData.append("timestamp", timestamp);
      formData.append("folder", folder);
      formData.append("signature", signature);
      console.log("[Cloudinary] Uploading to folder:", folder, "cloud:", cloudName);
      const res = await fetch("https://api.cloudinary.com/v1_1/" + cloudName + "/image/upload", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        const errMsg = result.error ? result.error.message : "HTTP " + res.status;
        console.error("[Cloudinary] Upload failed:", errMsg);
        throw new Error("Cloudinary upload failed: " + errMsg);
      }
      console.log("[Cloudinary] Upload success:", result.secure_url);
      return { secure_url: result.secure_url, public_id: result.public_id };
    }
    __name(uploadToCloudinary, "uploadToCloudinary");
    __name2(uploadToCloudinary, "uploadToCloudinary");
    async function hashPassword(password) {
      const data = new TextEncoder().encode(password + "_tbk_salt_2026");
      const hash = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(hashPassword, "hashPassword");
    __name2(hashPassword, "hashPassword");
    async function sendEmail(to, subject, html, env, attachments) {
      const apiKey = env.EMAIL_API_KEY;
      if (!apiKey) {
        console.log("[Email] EMAIL_API_KEY not configured, skipping email to:", to);
        return { sent: false, reason: "EMAIL_API_KEY not configured" };
      }
      const from = env.EMAIL_FROM || "Tabbakheen <noreply@tabbakheen.com>";
      try {
        const payload = { from, to: [to], subject, html };
        if (attachments && attachments.length > 0) {
          payload.attachments = attachments;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          console.log("[Email] Sent to", to, "id:", data.id);
          return { sent: true, id: data.id };
        } else {
          console.error("[Email] Failed:", JSON.stringify(data));
          return { sent: false, reason: data.message || "Failed" };
        }
      } catch (e) {
        console.error("[Email] Error:", e);
        return { sent: false, reason: e.message };
      }
    }
    __name(sendEmail, "sendEmail");
    __name2(sendEmail, "sendEmail");
    function isExpoPushToken(token) {
      return typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
    }
    __name(isExpoPushToken, "isExpoPushToken");
    __name2(isExpoPushToken, "isExpoPushToken");
    function normalizeSaudiWhatsApp(value) {
      const raw = String(value == null ? "" : value).trim();
      if (!raw) return "";
      let digits = raw.replace(/[^\d]/g, "");
      if (digits.startsWith("00966")) digits = digits.slice(2);
      if (digits.startsWith("05") && digits.length === 10) digits = "966" + digits.slice(1);
      else if (digits.startsWith("5") && digits.length === 9) digits = "966" + digits;
      if (!/^9665\d{8}$/.test(digits)) return null;
      return digits;
    }
    __name(normalizeSaudiWhatsApp, "normalizeSaudiWhatsApp");
    __name2(normalizeSaudiWhatsApp, "normalizeSaudiWhatsApp");
    function incrementReason(reasons, code, message) {
      const safeCode = String(code || "UnknownError").slice(0, 80);
      const safeMessage = String(message || "").replace(/ExponentPushToken\[[^\]]+\]|ExpoPushToken\[[^\]]+\]/g, "[redacted-token]").slice(0, 240);
      if (!reasons[safeCode]) reasons[safeCode] = { count: 0, message: safeMessage };
      reasons[safeCode].count++;
      if (!reasons[safeCode].message && safeMessage) reasons[safeCode].message = safeMessage;
    }
    __name(incrementReason, "incrementReason");
    __name2(incrementReason, "incrementReason");
    async function sendAdminBroadcast(users, title, message, accessToken) {
      const tokenOwners = /* @__PURE__ */ new Map();
      let totalCandidateTokens = 0;
      let invalidTokensCount = 0;
      for (const user of users) {
        const token = user && typeof user.expoPushToken === "string" ? user.expoPushToken.trim() : "";
        if (!token) continue;
        totalCandidateTokens++;
        if (!isExpoPushToken(token)) {
          invalidTokensCount++;
          continue;
        }
        if (!tokenOwners.has(token)) tokenOwners.set(token, []);
        tokenOwners.get(token).push(user._id);
      }
      const validTokens = Array.from(tokenOwners.keys());
      let sentCount = 0;
      let failedCount = 0;
      let staleTokensCount = 0;
      const failureReasons = {};
      const chunks = [];
      for (let i = 0; i < validTokens.length; i += 100) chunks.push(validTokens.slice(i, i + 100));
      for (const tokenChunk of chunks) {
        const messages = tokenChunk.map((token) => ({
          to: token,
          title,
          body: message,
          sound: "default",
          data: { type: "admin_broadcast" }
        }));
        try {
          const expoResp = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(messages)
          });
          let expoResult = null;
          try {
            expoResult = await expoResp.json();
          } catch {
            expoResult = null;
          }
          if (!expoResp.ok) {
            failedCount += messages.length;
            incrementReason(failureReasons, "ExpoHTTP" + expoResp.status, expoResult && (expoResult.message || expoResult.error) || "Expo Push API rejected the request");
            continue;
          }
          if (!expoResult || !Array.isArray(expoResult.data)) {
            failedCount += messages.length;
            incrementReason(failureReasons, "MalformedExpoResponse", "Expo Push API returned no ticket array");
            continue;
          }
          for (let i = 0; i < messages.length; i++) {
            const ticket = expoResult.data[i];
            if (ticket && ticket.status === "ok" && typeof ticket.id === "string" && ticket.id.trim().length > 0) {
              sentCount++;
              continue;
            }
            failedCount++;
            const malformedSuccess = ticket && ticket.status === "ok";
            const code = malformedSuccess ? "MalformedExpoTicket" : ticket && ticket.details && ticket.details.error || "ExpoTicketError";
            const reason = malformedSuccess ? "Expo returned an accepted ticket without an ID" : ticket && ticket.message || "Expo rejected the push notification";
            incrementReason(failureReasons, code, reason);
            if (code === "DeviceNotRegistered") {
              staleTokensCount++;
              const owners = tokenOwners.get(tokenChunk[i]) || [];
              for (const uid of owners) {
                try {
                  await updateFirestoreDocument("users", uid, { expoPushToken: null }, accessToken);
                } catch (e) {
                  incrementReason(failureReasons, "StaleTokenCleanupFailed", e && e.message || "Could not clear stale token");
                }
              }
            }
          }
          if (expoResult.data.length < messages.length) {
            const missing = messages.length - expoResult.data.length;
            incrementReason(failureReasons, "MissingExpoTickets", "Expo returned fewer tickets than submitted messages");
          }
        } catch (e) {
          failedCount += messages.length;
          incrementReason(failureReasons, "ExpoNetworkError", e && e.message || "Expo Push API request failed");
        }
      }
      return {
        totalCandidateTokens,
        validTokensCount: validTokens.length,
        sentCount,
        acceptedCount: sentCount,
        failedCount,
        invalidTokensCount,
        staleTokensCount,
        failureReasons
      };
    }
    __name(sendAdminBroadcast, "sendAdminBroadcast");
    __name2(sendAdminBroadcast, "sendAdminBroadcast");
    async function getUserPushToken(uid, accessToken) {
      const user = await getFirestoreDoc("users", uid, accessToken);
      if (!user) return null;
      const token = user.expoPushToken;
      if (!token || !isExpoPushToken(token)) return null;
      return token;
    }
    __name(getUserPushToken, "getUserPushToken");
    __name2(getUserPushToken, "getUserPushToken");
    async function getDriverPushTokens(accessToken) {
      const drivers = await queryFirestore("users", "role", "EQUAL", "driver", accessToken);
      return drivers.filter((d) => d && d.pushNotificationsEnabled === true && d.expoPushToken && isExpoPushToken(d.expoPushToken)).map((d) => d.expoPushToken);
    }
    __name(getDriverPushTokens, "getDriverPushTokens");
    __name2(getDriverPushTokens, "getDriverPushTokens");
    async function sendExpoPush(messages) {
      if (!messages.length) return;
      const chunks = [];
      for (let i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        try {
          const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(chunk)
          });
          const result = await response.json();
          console.log("[Push] Expo response:", JSON.stringify(result));
        } catch (e) {
          console.error("[Push] Error sending chunk:", e);
        }
      }
    }
    __name(sendExpoPush, "sendExpoPush");
    __name2(sendExpoPush, "sendExpoPush");
    async function handleEvent(event, orderId, accessToken) {
      const order = await getFirestoreDoc("orders", orderId, accessToken);
      if (!order) {
        return { success: false, error: "Order not found" };
      }
      const orderLabel = order.offerTitleSnapshot || order.orderNumber || orderId;
      const messages = [];
      switch (event) {
        case "order_accepted": {
          if (order.customerUid) {
            const token = await getUserPushToken(order.customerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0637\u0644\u0628\u0643 \u2705",
                body: '\u0637\u0644\u0628\u0643 "' + orderLabel + '" \u062A\u0645 \u0642\u0628\u0648\u0644\u0647 \u0648\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0636\u064A\u0631',
                data: { type: "order_accepted", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "order_ready": {
          if (order.customerUid) {
            const token = await getUserPushToken(order.customerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u0637\u0644\u0628\u0643 \u062C\u0627\u0647\u0632 \u{1F37D}\uFE0F",
                body: '\u0637\u0644\u0628\u0643 "' + orderLabel + '" \u062C\u0627\u0647\u0632. \u0627\u062E\u062A\u0631 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645',
                data: { type: "order_ready", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "self_pickup_selected": {
          if (order.providerUid) {
            const token = await getUserPushToken(order.providerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u0627\u0633\u062A\u0644\u0627\u0645 \u0630\u0627\u062A\u064A \u{1F4E6}",
                body: '\u0627\u0644\u0639\u0645\u064A\u0644 \u0633\u064A\u0633\u062A\u0644\u0645 \u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u0628\u0646\u0641\u0633\u0647',
                data: { type: "self_pickup_selected", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "driver_delivery_requested": {
          if (order.providerUid) {
            const providerToken = await getUserPushToken(order.providerUid, accessToken);
            if (providerToken) {
              messages.push({
                to: providerToken,
                title: "\u062A\u0648\u0635\u064A\u0644 \u0628\u0645\u0646\u062F\u0648\u0628 \u{1F697}",
                body: '\u0627\u0644\u0639\u0645\u064A\u0644 \u0637\u0644\u0628 \u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u0628\u0648\u0627\u0633\u0637\u0629 \u0645\u0646\u062F\u0648\u0628',
                data: { type: "driver_delivery_requested", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          const driverTokens = await getDriverPushTokens(accessToken);
          for (const token of driverTokens) {
            messages.push({
              to: token,
              title: "\u062A\u0648\u0635\u064A\u0644\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u062A\u0627\u062D\u0629 \u{1F680}",
              body: '\u062A\u0648\u0635\u064A\u0644\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u062A\u0627\u062D\u0629 \u0644\u0644\u0637\u0644\u0628 "' + orderLabel + '"',
              data: { type: "new_delivery_available", orderId, role: "driver" },
              sound: "default"
            });
          }
          break;
        }
        case "driver_assigned": {
          if (order.customerUid) {
            const customerToken = await getUserPushToken(order.customerUid, accessToken);
            if (customerToken) {
              messages.push({
                to: customerToken,
                title: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0645\u0646\u062F\u0648\u0628 \u{1F3CD}\uFE0F",
                body: '\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0645\u0646\u062F\u0648\u0628 \u0644\u062A\u0648\u0635\u064A\u0644 \u0637\u0644\u0628\u0643 "' + orderLabel + '"',
                data: { type: "driver_assigned", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          if (order.providerUid) {
            const providerToken = await getUserPushToken(order.providerUid, accessToken);
            if (providerToken) {
              messages.push({
                to: providerToken,
                title: "\u0645\u0646\u062F\u0648\u0628 \u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642 \u{1F3CD}\uFE0F",
                body: '\u0645\u0646\u062F\u0648\u0628 \u0641\u064A \u0637\u0631\u064A\u0642\u0647 \u0644\u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '"',
                data: { type: "driver_assigned", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "picked_up": {
          if (order.customerUid) {
            const token = await getUserPushToken(order.customerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0633\u062A\u0644\u0645 \u0637\u0644\u0628\u0643 \u{1F4E6}",
                body: '\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0633\u062A\u0644\u0645 \u0637\u0644\u0628\u0643 "' + orderLabel + '" \u0648\u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642 \u0625\u0644\u064A\u0643',
                data: { type: "order_picked_up", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "arrived": {
          if (order.customerUid) {
            const token = await getUserPushToken(order.customerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0648\u0635\u0644 \u{1F4CD}",
                body: '\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0648\u0635\u0644 \u0644\u0645\u0648\u0642\u0639\u0643 \u0628\u0637\u0644\u0628\u0643 "' + orderLabel + '"',
                data: { type: "driver_arrived", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "delivered": {
          if (order.customerUid) {
            const customerToken = await getUserPushToken(order.customerUid, accessToken);
            if (customerToken) {
              messages.push({
                to: customerToken,
                title: "\u062A\u0645 \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u2705",
                body: '\u0637\u0644\u0628\u0643 "' + orderLabel + '" \u062A\u0645 \u062A\u0648\u0635\u064A\u0644\u0647 \u0628\u0646\u062C\u0627\u062D',
                data: { type: "order_delivered", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          if (order.providerUid) {
            const providerToken = await getUserPushToken(order.providerUid, accessToken);
            if (providerToken) {
              messages.push({
                to: providerToken,
                title: "\u062A\u0645 \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u2705",
                body: '\u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u062A\u0645 \u062A\u0648\u0635\u064A\u0644\u0647 \u0644\u0644\u0639\u0645\u064A\u0644 \u0628\u0646\u062C\u0627\u062D',
                data: { type: "order_delivered", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "self_pickup_completed": {
          if (order.customerUid) {
            const token = await getUserPushToken(order.customerUid, accessToken);
            if (token) {
              messages.push({
                to: token,
                title: "\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0637\u0644\u0628 \u2705",
                body: '\u0637\u0644\u0628\u0643 "' + orderLabel + '" \u062A\u0645 \u062A\u0633\u0644\u064A\u0645\u0647 \u0628\u0646\u062C\u0627\u062D',
                data: { type: "order_completed", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "order_created": {
          if (order.providerUid) {
            const t_provider = await getUserPushToken(order.providerUid, accessToken);
            if (t_provider) {
              messages.push({
                to: t_provider,
                title: "\u0637\u0644\u0628 \u062C\u062F\u064A\u062F \uD83D\uDECE\uFE0F",
                body: '\u0648\u0635\u0644\u0643 \u0637\u0644\u0628 \u062C\u062F\u064A\u062F "' + orderLabel + '" \u2014 \u0627\u0641\u062A\u062D \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0644\u0642\u0628\u0648\u0644\u0647',
                data: { type: "order_created", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "order_rejected": {
          if (order.customerUid) {
            const t_customer = await getUserPushToken(order.customerUid, accessToken);
            if (t_customer) {
              messages.push({
                to: t_customer,
                title: "\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628\u0643 \u274C",
                body: '\u0637\u0644\u0628\u0643 "' + orderLabel + '" \u062A\u0645 \u0631\u0641\u0636\u0647 \u0645\u0646 \u0645\u0642\u062F\u0645 \u0627\u0644\u062E\u062F\u0645\u0629',
                data: { type: "order_rejected", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "order_preparing": {
          if (order.customerUid) {
            const t_customer = await getUserPushToken(order.customerUid, accessToken);
            if (t_customer) {
              messages.push({
                to: t_customer,
                title: "\u062C\u0627\u0631\u064A \u062A\u062D\u0636\u064A\u0631 \u0637\u0644\u0628\u0643 \uD83D\uDC68\u200D\uD83C\uDF73",
                body: '\u0628\u062F\u0623 \u062A\u062D\u0636\u064A\u0631 \u0637\u0644\u0628\u0643 "' + orderLabel + '"',
                data: { type: "order_preparing", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "order_cancelled": {
          if (order.customerUid) {
            const t_customer = await getUserPushToken(order.customerUid, accessToken);
            if (t_customer) {
              messages.push({
                to: t_customer,
                title: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u26D4",
                body: '\u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u062A\u0645 \u0625\u0644\u063A\u0627\u0624\u0647',
                data: { type: "order_cancelled", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          if (order.providerUid) {
            const t_provider = await getUserPushToken(order.providerUid, accessToken);
            if (t_provider) {
              messages.push({
                to: t_provider,
                title: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u26D4",
                body: '\u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u062A\u0645 \u0625\u0644\u063A\u0627\u0624\u0647',
                data: { type: "order_cancelled", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "driver_assigned_by_provider": {
          if (order.driverUid) {
            const t_driver = await getUserPushToken(order.driverUid, accessToken);
            if (t_driver) {
              messages.push({
                to: t_driver,
                title: "\u062A\u0648\u0635\u064A\u0644\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u0633\u0646\u062F\u0629 \u0644\u0643 \uD83D\uDEF5",
                body: '\u062A\u0645 \u0625\u0633\u0646\u0627\u062F \u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u0625\u0644\u064A\u0643',
                data: { type: "driver_assigned", orderId, role: "driver" },
                sound: "default"
              });
            }
          }
          if (order.customerUid) {
            const t_customer = await getUserPushToken(order.customerUid, accessToken);
            if (t_customer) {
              messages.push({
                to: t_customer,
                title: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0645\u0646\u062F\u0648\u0628 \uD83C\uDFCD\uFE0F",
                body: '\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0645\u0646\u062F\u0648\u0628 \u0644\u062A\u0648\u0635\u064A\u0644 \u0637\u0644\u0628\u0643 "' + orderLabel + '"',
                data: { type: "driver_assigned", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "delivery_pending_confirmation": {
          if (order.customerUid) {
            const t_customer = await getUserPushToken(order.customerUid, accessToken);
            if (t_customer) {
              messages.push({
                to: t_customer,
                title: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645 \uD83D\uDCE6",
                body: '\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0633\u0644\u0651\u0645 \u0637\u0644\u0628\u0643 "' + orderLabel + '" \u2014 \u0623\u0643\u062F \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645 \u0645\u0646 \u0627\u0644\u062A\u0637\u0628\u064A\u0642',
                data: { type: "delivery_pending_confirmation", orderId, role: "customer" },
                sound: "default"
              });
            }
          }
          break;
        }
        case "driver_rejected": {
          if (order.providerUid) {
            const t_provider = await getUserPushToken(order.providerUid, accessToken);
            if (t_provider) {
              messages.push({
                to: t_provider,
                title: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0639\u062A\u0630\u0631 \u0639\u0646 \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u26A0\uFE0F",
                body: '\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0639\u062A\u0630\u0631 \u0639\u0646 \u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0637\u0644\u0628 "' + orderLabel + '" \u2014 \u062C\u0627\u0631\u064A \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0645\u0646\u062F\u0648\u0628 \u0622\u062E\u0631',
                data: { type: "driver_rejected", orderId, role: "provider" },
                sound: "default"
              });
            }
          }
          break;
        }
        default:
          return { success: false, error: "Unknown event: " + event };
      }
      if (messages.length > 0) {
        await sendExpoPush(messages);
        console.log("[Push] Sent " + messages.length + " notifications for " + event + " on order " + orderId);
      }
      return { success: true, notificationsSent: messages.length };
    }
    __name(handleEvent, "handleEvent");
    __name2(handleEvent, "handleEvent");
    async function createAdminToken(env) {
      const exp = Date.now() + 24 * 60 * 60 * 1e3;
      const payload = btoa(JSON.stringify({ exp, r: Math.random().toString(36).slice(2) }));
      const secret = env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return payload + "." + sigB64;
    }
    __name(createAdminToken, "createAdminToken");
    __name2(createAdminToken, "createAdminToken");
    async function verifyAdminToken(token, env) {
      try {
        if (!token) return false;
        const parts = token.split(".");
        if (parts.length !== 2) return false;
        const [payload, sigB64] = parts;
        const data = JSON.parse(atob(payload));
        if (Date.now() > data.exp) return false;
        const secret = env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD;
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const normalizedSig = sigB64.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalizedSig + "=".repeat((4 - normalizedSig.length % 4) % 4);
        const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        return await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
      } catch (e) {
        console.error("[Admin] Token verify error:", e);
        return false;
      }
    }
    __name(verifyAdminToken, "verifyAdminToken");
    __name2(verifyAdminToken, "verifyAdminToken");
    async function verifyAdminPassword(password, env, accessToken) {
      if (password === env.ADMIN_PASSWORD) return true;
      try {
        const adminDoc = await getFirestoreDoc("app_config", "admin", accessToken);
        if (adminDoc && adminDoc.passwordHash) {
          const inputHash = await hashPassword(password);
          return inputHash === adminDoc.passwordHash;
        }
      } catch (e) {
        console.log("[Admin] Firestore password check error:", e);
      }
      return false;
    }
    __name(verifyAdminPassword, "verifyAdminPassword");
    __name2(verifyAdminPassword, "verifyAdminPassword");
    async function createSignedInvoiceToken(invoiceId, env) {
      const exp = Date.now() + 60 * 60 * 1e3;
      const payload = btoa(JSON.stringify({ inv: invoiceId, exp }));
      const secret = env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return payload + "." + sigB64;
    }
    __name(createSignedInvoiceToken, "createSignedInvoiceToken");
    __name2(createSignedInvoiceToken, "createSignedInvoiceToken");
    async function verifySignedInvoiceToken(token, invoiceId, env) {
      try {
        if (!token) return false;
        const parts = token.split(".");
        if (parts.length !== 2) return false;
        const [payload, sigB64] = parts;
        const data = JSON.parse(atob(payload));
        if (Date.now() > data.exp) return false;
        if (data.inv !== invoiceId) return false;
        const secret = env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD;
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const normalizedSig = sigB64.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalizedSig + "=".repeat((4 - normalizedSig.length % 4) % 4);
        const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        return await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
      } catch {
        return false;
      }
    }
    __name(verifySignedInvoiceToken, "verifySignedInvoiceToken");
    __name2(verifySignedInvoiceToken, "verifySignedInvoiceToken");
    function getTokenFromRequest(request) {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7);
      }
      return null;
    }
    __name(getTokenFromRequest, "getTokenFromRequest");
    __name2(getTokenFromRequest, "getTokenFromRequest");
    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    __name(jsonResponse, "jsonResponse");
    __name2(jsonResponse, "jsonResponse");
    function base64urlDecode(input) {
      const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    __name(base64urlDecode, "base64urlDecode");
    __name2(base64urlDecode, "base64urlDecode");
    function base64urlDecodeJson(input) {
      return JSON.parse(new TextDecoder().decode(base64urlDecode(input)));
    }
    __name(base64urlDecodeJson, "base64urlDecodeJson");
    __name2(base64urlDecodeJson, "base64urlDecodeJson");
    var FIREBASE_JWKS_CACHE = null;
    var FIREBASE_JWKS_CACHE_EXP = 0;
    async function getFirebaseJwks() {
      if (FIREBASE_JWKS_CACHE && Date.now() < FIREBASE_JWKS_CACHE_EXP) return FIREBASE_JWKS_CACHE;
      const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
      if (!response.ok) {
        throw new Error("Firebase JWKS fetch failed: " + response.status);
      }
      const cacheControl = response.headers.get("cache-control") || "";
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
      FIREBASE_JWKS_CACHE = await response.json();
      FIREBASE_JWKS_CACHE_EXP = Date.now() + Math.max(300, maxAge) * 1e3;
      return FIREBASE_JWKS_CACHE;
    }
    __name(getFirebaseJwks, "getFirebaseJwks");
    __name2(getFirebaseJwks, "getFirebaseJwks");
    async function verifyFirebaseIdToken(idToken) {
      if (!idToken || typeof idToken !== "string") throw new Error("Missing Firebase ID token");
      const parts = idToken.split(".");
      if (parts.length !== 3) throw new Error("Invalid Firebase ID token");
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const header = base64urlDecodeJson(encodedHeader);
      const payload = base64urlDecodeJson(encodedPayload);
      if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Firebase token header");
      const projectId = "tabbakheen-99883";
      const now = Math.floor(Date.now() / 1e3);
      if (payload.aud !== projectId) throw new Error("Invalid Firebase token audience");
      if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("Invalid Firebase token issuer");
      if (!payload.sub || typeof payload.sub !== "string") throw new Error("Invalid Firebase token subject");
      if (payload.exp <= now) throw new Error("Expired Firebase token");
      if (payload.iat && payload.iat > now + 300) throw new Error("Invalid Firebase token issued time");
      const jwks = await getFirebaseJwks();
      const jwk = (jwks.keys || []).find((key2) => key2.kid === header.kid);
      if (!jwk) throw new Error("Firebase token signing key not found");
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const signature = base64urlDecode(encodedSignature);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        signature,
        new TextEncoder().encode(encodedHeader + "." + encodedPayload)
      );
      if (!valid) throw new Error("Invalid Firebase token signature");
      return payload.sub;
    }
    __name(verifyFirebaseIdToken, "verifyFirebaseIdToken");
    __name2(verifyFirebaseIdToken, "verifyFirebaseIdToken");
    function isCrActive(data) {
      const status = data && typeof data === "object" ? data.status : null;
      if (!status || typeof status !== "object") {
        return { active: false, token: "no_status_field" };
      }
      const idActive = String(status.id).trim() === "1";
      const name = typeof status.name === "string" ? status.name.trim() : "";
      const nameActive = name === "\u0646\u0634\u0637" || name === "\u0641\u0639\u0627\u0644" || name === "\u0641\u0639\u0651\u0627\u0644";
      if (idActive || nameActive) {
        return { active: true, token: idActive ? "id_1" : "name_active" };
      }
      return { active: false, token: "not_active" };
    }
    __name(isCrActive, "isCrActive");
    __name2(isCrActive, "isCrActive");
    async function fetchWathqCommercialRegistration(crNumber, env) {
      if (!env.WATHQ_API_KEY) throw new Error("WATHQ_API_KEY is not configured");
      const targetUrl = "https://api.wathq.sa/commercial-registration/fullinfo/" + encodeURIComponent(crNumber);
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "apiKey": env.WATHQ_API_KEY,
          "Accept": "application/json"
        }
      });
      if (response.ok) {
        const data = await response.json();
        const result = isCrActive(data);
        return { ok: true, active: result.active, statusToken: result.token };
      }
      return { ok: false, active: false, status: response.status, statusToken: "wathq_http_" + response.status };
    }
    __name(fetchWathqCommercialRegistration, "fetchWathqCommercialRegistration");
    __name2(fetchWathqCommercialRegistration, "fetchWathqCommercialRegistration");
    async function handleVerifyCr(request, env, accessToken) {
      const idToken = getTokenFromRequest(request);
      let uid = "";
      try {
        uid = await verifyFirebaseIdToken(idToken);
      } catch (e) {
        console.log("[Wathq] Firebase token verification failed");
        return jsonResponse({ success: false, verificationStatus: "pending_review", error: "Unauthorized" }, 401);
      }
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const crNumber = String(body.crNumber || "").trim();
      if (!/^\d{10}$/.test(crNumber)) {
        return jsonResponse({ success: false, verificationStatus: "pending_review", error: "Invalid CR number format" }, 400);
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await updateFirestoreDocument("users", uid, { verificationStatus: "pending_review" }, accessToken);
      await createFirestoreDocument("verifications", uid, { crNumber, submittedAt: now, checkedAt: now }, accessToken);
      try {
        const result = await fetchWathqCommercialRegistration(crNumber, env);
        if (result.active) {
          await updateFirestoreDocument("users", uid, {
            verificationStatus: "verified",
            verificationSource: "wathq",
            verifiedAt: now
          }, accessToken);
          await updateFirestoreDocument("verifications", uid, {
            checkedAt: now,
            verificationSource: "wathq",
            internalError: "",
            statusToken: result.statusToken || "verified"
          }, accessToken);
          return jsonResponse({ success: true, verificationStatus: "verified", verifiedAt: now });
        }
        await updateFirestoreDocument("users", uid, { verificationStatus: "pending_review" }, accessToken);
        await updateFirestoreDocument("verifications", uid, {
          checkedAt: now,
          internalError: result && result.statusToken ? result.statusToken : result && result.status ? "wathq_http_" + result.status : "wathq_not_active_or_unclear"
        }, accessToken);
        return jsonResponse({ success: true, verificationStatus: "pending_review" });
      } catch (e) {
        await updateFirestoreDocument("users", uid, { verificationStatus: "pending_review" }, accessToken);
        await updateFirestoreDocument("verifications", uid, {
          checkedAt: now,
          internalError: e && e.message ? e.message.slice(0, 180) : "wathq_unreachable"
        }, accessToken);
        return jsonResponse({ success: true, verificationStatus: "pending_review" });
      }
    }
    __name(handleVerifyCr, "handleVerifyCr");
    __name2(handleVerifyCr, "handleVerifyCr");
    async function handleSubmitFreelanceCert(request, env, accessToken) {
      const idToken = getTokenFromRequest(request);
      let uid = "";
      try {
        uid = await verifyFirebaseIdToken(idToken);
      } catch (e) {
        console.log("[Freelance] Firebase token verification failed");
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const certificateNumber = String(body.certificateNumber || "").trim();
      const fileUrl = String(body.fileUrl || "").trim();
      if (!certificateNumber) {
        return jsonResponse({ success: false, error: "certificateNumber is required" }, 400);
      }
      if (!fileUrl) {
        return jsonResponse({ success: false, error: "fileUrl is required" }, 400);
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await updateFirestoreDocument("verifications", uid, {
        freelanceCertificate: {
          certificateNumber,
          fileUrl,
          submittedAt: now,
          reviewStatus: "pending"
        }
      }, accessToken);
      const udoc = await getFirestoreDoc("users", uid, accessToken);
      const curStatus = udoc && udoc.verificationStatus ? udoc.verificationStatus : "";
      const curSource = udoc && udoc.verificationSource ? udoc.verificationSource : "";
      const alreadyWathqVerified = curStatus === "verified" && curSource === "wathq";
      if (!alreadyWathqVerified) {
        await updateFirestoreDocument("users", uid, { verificationStatus: "pending_review" }, accessToken);
      }
      return jsonResponse({ success: true, verificationStatus: alreadyWathqVerified ? curStatus : "pending_review" });
    }
    __name(handleSubmitFreelanceCert, "handleSubmitFreelanceCert");
    __name2(handleSubmitFreelanceCert, "handleSubmitFreelanceCert");
    function pdfEscape(str) {
      if (!str) return "";
      return String(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r/g, "\\r");
    }
    __name(pdfEscape, "pdfEscape");
    __name2(pdfEscape, "pdfEscape");
    var LOGO_URL = "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/mp58h8z5x4szfl3c5f7xm";
    function generatePDFBytes(invoice, lang) {
      const isAr = lang === "ar";
      const biz = {
        name: "\u0645\u0624\u0633\u0633\u0629 \u0633\u0627\u0644\u0645 \u0628\u0646 \u0639\u0644\u064A \u0627\u0644\u0646\u0639\u064A\u0645\u064A",
        nameEn: "Salem Bin Ali Al-Nuaimi Est.",
        cr: "7050191290",
        building: "2500",
        street: "\u0623\u062D\u0645\u062F \u0628\u0646 \u062D\u062C\u0631 \u0627\u0644\u0639\u0633\u0642\u0644\u0627\u0646\u064A",
        streetEn: "Ahmad bin Hajar Al-Asqalani",
        district: "\u062D\u064A \u0637\u064A\u0628\u0629",
        districtEn: "Taibah District",
        city: "\u0627\u0644\u062C\u0628\u064A\u0644",
        cityEn: "Jubail",
        postal: "35513",
        country: "\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629",
        countryEn: "Kingdom of Saudi Arabia"
      };
      const invoiceNumber = invoice.invoiceNumber || "N/A";
      const createdDate = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString(isAr ? "ar-SA" : "en-US") : "N/A";
      const userName = invoice.userName || "N/A";
      const userEmail = invoice.userEmail || "";
      const userPhone = invoice.userPhone || "";
      const plan = invoice.subscriptionPlan || "Basic";
      const amount = invoice.amount || 0;
      const currency = invoice.currency || "SAR";
      const startDate = invoice.startDate || "";
      const endDate = invoice.endDate || "";
      const paymentMethod = invoice.paymentMethod || "";
      const notes = invoice.notes || "";
      const objects = [];
      let objectCount = 0;
      const offsets = [];
      function addObject(content) {
        objectCount++;
        objects.push(content);
        return objectCount;
      }
      __name(addObject, "addObject");
      __name2(addObject, "addObject");
      const catalogId = addObject("");
      const pagesId = addObject("");
      const pageId = addObject("");
      const fontId = addObject(
        `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
      );
      const fontBoldId = addObject(
        `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`
      );
      const pageW = 595.28;
      const pageH = 841.89;
      const margin = 50;
      let y = pageH - margin;
      let streamContent = "";
      function addText(text, x, yPos, size, font, color) {
        const safeText = pdfEscape(text);
        const f = font === "bold" ? "F2" : "F1";
        const c = color || "0 0 0";
        streamContent += `BT
/${f} ${size} Tf
${c} rg
${x} ${yPos} Td
(${safeText}) Tj
ET
`;
      }
      __name(addText, "addText");
      __name2(addText, "addText");
      function addCenteredText(text, yPos, size, font, color) {
        const safeText = pdfEscape(text);
        const f = font === "bold" ? "F2" : "F1";
        const c = color || "0 0 0";
        const approxWidth = safeText.length * size * 0.52;
        const x = (pageW - approxWidth) / 2;
        streamContent += `BT
/${f} ${size} Tf
${c} rg
${x} ${yPos} Td
(${safeText}) Tj
ET
`;
      }
      __name(addCenteredText, "addCenteredText");
      __name2(addCenteredText, "addCenteredText");
      function addLine(x1, y1, x2, y2, width, color) {
        const c = color || "0 0 0";
        streamContent += `${c} RG
${width || 1} w
${x1} ${y1} m
${x2} ${y2} l
S
`;
      }
      __name(addLine, "addLine");
      __name2(addLine, "addLine");
      function addRect(x, yPos, w, h, color) {
        const c = color || "0.95 0.95 0.95";
        streamContent += `${c} rg
${x} ${yPos} ${w} ${h} re
f
`;
      }
      __name(addRect, "addRect");
      __name2(addRect, "addRect");
      function addCircle(cx, cy, r, fillColor, strokeColor, strokeWidth) {
        const k = 0.5523;
        const kr = k * r;
        if (fillColor) streamContent += `${fillColor} rg
`;
        if (strokeColor) streamContent += `${strokeColor} RG
${strokeWidth || 1} w
`;
        streamContent += `${cx} ${cy + r} m
`;
        streamContent += `${cx + kr} ${cy + r} ${cx + r} ${cy + kr} ${cx + r} ${cy} c
`;
        streamContent += `${cx + r} ${cy - kr} ${cx + kr} ${cy - r} ${cx} ${cy - r} c
`;
        streamContent += `${cx - kr} ${cy - r} ${cx - r} ${cy - kr} ${cx - r} ${cy} c
`;
        streamContent += `${cx - r} ${cy + kr} ${cx - kr} ${cy + r} ${cx} ${cy + r} c
`;
        if (fillColor && strokeColor) streamContent += "B\n";
        else if (fillColor) streamContent += "f\n";
        else streamContent += "S\n";
      }
      __name(addCircle, "addCircle");
      __name2(addCircle, "addCircle");
      const headerH = 120;
      addRect(0, pageH - headerH, pageW, headerH, "0.91 0.45 0.16");
      const badgeCx = pageW / 2;
      const badgeCy = pageH - headerH + 5;
      const badgeR = 50;
      addCircle(badgeCx, badgeCy, badgeR + 2, "0.85 0.85 0.85", null, 0);
      addCircle(badgeCx, badgeCy, badgeR, "1 1 1", null, 0);
      addCenteredText("T", badgeCy - 8, 36, "bold", "0.91 0.45 0.16");
      y = badgeCy - badgeR - 16;
      addCenteredText("Tabbakheen", y, 22, "bold", "0.91 0.45 0.16");
      y -= 18;
      addCenteredText("Tabakheen", y, 11, "normal", "0.5 0.5 0.5");
      const metaX = pageW - margin - 160;
      const metaY = pageH - 40;
      addText("Invoice", metaX, metaY, 18, "bold", "1 1 1");
      addText("#" + invoiceNumber, metaX, metaY - 18, 10, "normal", "1 0.95 0.9");
      addText("Date: " + createdDate, metaX, metaY - 32, 10, "normal", "1 0.95 0.9");
      y -= 30;
      addRect(margin, y - 80, 230, 80, "0.96 0.97 0.98");
      addText("ISSUED BY", margin + 10, y - 15, 9, "bold", "0.91 0.45 0.16");
      addText(biz.nameEn, margin + 10, y - 30, 9, "bold", "0.1 0.1 0.1");
      addText("CR. " + biz.cr, margin + 10, y - 43, 8, "normal", "0.3 0.3 0.3");
      addText(biz.building + " " + biz.streetEn, margin + 10, y - 55, 8, "normal", "0.3 0.3 0.3");
      addText(biz.districtEn + ", " + biz.cityEn + " " + biz.postal, margin + 10, y - 67, 8, "normal", "0.3 0.3 0.3");
      addText(biz.countryEn, margin + 10, y - 79, 8, "normal", "0.3 0.3 0.3");
      addRect(pageW - margin - 230, y - 80, 230, 80, "0.96 0.97 0.98");
      addText("INVOICE TO", pageW - margin - 220, y - 15, 9, "bold", "0.91 0.45 0.16");
      addText(userName, pageW - margin - 220, y - 30, 9, "bold", "0.1 0.1 0.1");
      if (userEmail) addText(userEmail, pageW - margin - 220, y - 43, 8, "normal", "0.3 0.3 0.3");
      if (userPhone) addText(userPhone, pageW - margin - 220, y - 55, 8, "normal", "0.3 0.3 0.3");
      y -= 110;
      const tableX = margin;
      const tableW = pageW - 2 * margin;
      const col1W = tableW * 0.4;
      const col2W = tableW * 0.35;
      const rowH = 28;
      addRect(tableX, y - rowH, tableW, rowH, "0.94 0.96 0.98");
      addText("Description", tableX + 10, y - 18, 9, "bold", "0.3 0.3 0.3");
      addText("Period", tableX + col1W + 10, y - 18, 9, "bold", "0.3 0.3 0.3");
      addText("Amount", tableX + col1W + col2W + 10, y - 18, 9, "bold", "0.3 0.3 0.3");
      y -= rowH;
      addLine(tableX, y, tableX + tableW, y, 0.5, "0.85 0.85 0.85");
      addText("Subscription - " + plan, tableX + 10, y - 18, 9, "normal", "0.1 0.1 0.1");
      addText(startDate + " - " + endDate, tableX + col1W + 10, y - 18, 9, "normal", "0.1 0.1 0.1");
      addText(amount + " " + currency, tableX + col1W + col2W + 10, y - 18, 9, "normal", "0.1 0.1 0.1");
      y -= rowH;
      addLine(tableX, y, tableX + tableW, y, 0.5, "0.85 0.85 0.85");
      addRect(tableX, y - rowH, tableW, rowH, "1 0.97 0.94");
      addText("Total", tableX + 10, y - 18, 10, "bold", "0.1 0.1 0.1");
      addText(amount + " " + currency, tableX + col1W + col2W + 10, y - 18, 10, "bold", "0.91 0.45 0.16");
      y -= rowH + 20;
      if (paymentMethod) {
        addText("Payment Method: " + paymentMethod, margin, y, 9, "normal", "0.3 0.3 0.3");
        y -= 16;
      }
      if (notes) {
        addText("Notes: " + notes, margin, y, 9, "normal", "0.3 0.3 0.3");
        y -= 16;
      }
      y -= 20;
      addLine(margin, y, pageW - margin, y, 0.5, "0.85 0.85 0.85");
      y -= 20;
      addText(biz.nameEn, margin, y, 8, "normal", "0.5 0.5 0.5");
      y -= 12;
      addText("CR: " + biz.cr + " | " + biz.building + " " + biz.streetEn + ", " + biz.districtEn + ", " + biz.cityEn + " " + biz.postal, margin, y, 7, "normal", "0.5 0.5 0.5");
      y -= 12;
      addText(biz.countryEn, margin, y, 7, "normal", "0.5 0.5 0.5");
      y -= 25;
      addRect(margin, y - 55, tableW, 55, "0.96 0.97 0.98");
      addText("Arabic Business Name:", margin + 10, y - 14, 8, "bold", "0.3 0.3 0.3");
      addText("Muassasat Salem bin Ali Al-Nuaimi", margin + 10, y - 28, 8, "normal", "0.3 0.3 0.3");
      addText("Commercial Reg: 7050191290 | Jubail, Saudi Arabia", margin + 10, y - 42, 8, "normal", "0.3 0.3 0.3");
      const streamId = addObject("");
      const streamBytes = new TextEncoder().encode(streamContent);
      objects[streamId - 1] = `<< /Length ${streamBytes.length} >>
stream
${streamContent}endstream`;
      objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`;
      objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
      objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
      let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
      for (let i = 0; i < objects.length; i++) {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj
${objects[i]}
endobj
`;
      }
      const xrefOffset = pdf.length;
      pdf += "xref\n";
      pdf += `0 ${objects.length + 1}
`;
      pdf += "0000000000 65535 f \n";
      for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
      }
      pdf += "trailer\n";
      pdf += `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>
`;
      pdf += "startxref\n";
      pdf += xrefOffset + "\n";
      pdf += "%%EOF\n";
      return new TextEncoder().encode(pdf);
    }
    __name(generatePDFBytes, "generatePDFBytes");
    __name2(generatePDFBytes, "generatePDFBytes");
    function generateInvoiceHTML(invoice, lang) {
      const isAr = lang === "ar";
      const dir = isAr ? "rtl" : "ltr";
      const biz = {
        name: "\u0645\u0624\u0633\u0633\u0629 \u0633\u0627\u0644\u0645 \u0628\u0646 \u0639\u0644\u064A \u0627\u0644\u0646\u0639\u064A\u0645\u064A",
        nameEn: "Salem Bin Ali Al-Nuaimi Est.",
        cr: "7050191290",
        building: "2500",
        street: "\u0623\u062D\u0645\u062F \u0628\u0646 \u062D\u062C\u0631 \u0627\u0644\u0639\u0633\u0642\u0644\u0627\u0646\u064A",
        streetEn: "Ahmad bin Hajar Al-Asqalani",
        district: "\u062D\u064A \u0637\u064A\u0628\u0629",
        districtEn: "Taibah District",
        city: "\u0627\u0644\u062C\u0628\u064A\u0644",
        cityEn: "Jubail",
        postal: "35513",
        country: "\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629",
        countryEn: "Kingdom of Saudi Arabia"
      };
      const invoiceNum = invoice.invoiceNumber || "N/A";
      const created = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString(isAr ? "ar-SA" : "en-US") : "N/A";
      return `<!DOCTYPE html><html dir="${dir}" lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629" : "Invoice"} ${invoiceNum}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f0f0f0;color:#1a1a2e}
.invoice{max-width:800px;margin:0 auto;background:#fff;border-radius:12px;overflow:visible;box-shadow:0 4px 24px rgba(0,0,0,.12)}
.inv-header{background:#e8722a;padding:30px 40px 60px;color:#fff;position:relative;border-radius:12px 12px 0 0;display:flex;justify-content:flex-end;align-items:flex-start;min-height:140px}
.logo-badge{position:absolute;left:50%;top:100%;transform:translate(-50%,-50%);width:110px;height:110px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:10}
.logo-badge img{width:78px;height:78px;object-fit:contain}
.inv-meta{text-align:${isAr ? "left" : "right"};z-index:5}
.inv-meta h2{font-size:20px;margin:0 0 8px;font-weight:700;opacity:.95}
.inv-meta p{font-size:12px;margin:3px 0;opacity:.9}
.brand-area{text-align:center;padding:65px 40px 20px;position:relative}
.brand-area h1{font-size:26px;font-weight:700;color:#e8722a;margin:0 0 2px}
.brand-area p{font-size:14px;color:#888;margin:0}
.inv-body{padding:10px 40px 30px}
.details{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
.detail-box{background:#f8fafc;border-radius:10px;padding:18px;border:1px solid #e8ecf0}
.detail-box h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#e8722a;margin:0 0 10px;font-weight:700}
.detail-box p{margin:3px 0;font-size:13px;color:#333}.detail-box .name{font-weight:700;font-size:14px}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#f1f5f9;padding:12px 16px;text-align:${isAr ? "right" : "left"};font-size:12px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:.3px;border-bottom:2px solid #e2e8f0}
td{padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:14px}
.total-row td{font-weight:700;font-size:16px;border-top:2px solid #e8722a;background:#fff8f0;color:#e8722a}
.meta-info{margin:16px 0;font-size:13px;color:#555}
.meta-info strong{color:#333}
.footer{margin-top:24px;padding:20px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#888;text-align:center;border-radius:0 0 12px 12px}
.footer p{margin:2px 0}
.bilingual{margin-top:16px;padding:16px;background:#fafbfc;border-radius:8px;border:1px solid #e8ecf0}
.bilingual h4{font-size:12px;color:#e8722a;margin:0 0 8px;font-weight:700}
.bilingual p{font-size:12px;color:#555;margin:2px 0;direction:rtl;text-align:right}
.actions{text-align:center;padding:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn{padding:10px 24px;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
.btn-primary{background:#e8722a;color:#fff}.btn-secondary{background:#e2e8f0;color:#333}
@media print{.actions{display:none!important}body{background:#fff;padding:0}.invoice{box-shadow:none;border-radius:0}.inv-header{border-radius:0}.footer{border-radius:0}}
</style></head><body>
<div class="invoice">
<div class="inv-header">
<div class="logo-badge"><img src="${LOGO_URL}" alt="Tabbakheen"></div>
<div class="inv-meta"><h2>${isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629" : "Invoice"}</h2>
<p>#${invoiceNum}</p>
<p>${isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date"}: ${created}</p>
</div></div>
<div class="brand-area">
<h1>Tabbakheen</h1>
<p>\u0637\u0628\u0627\u062E\u064A\u0646</p>
</div>
<div class="inv-body">
<div class="details">
<div class="detail-box">
<h3>${isAr ? "\u0635\u0627\u062F\u0631\u0629 \u0645\u0646" : "ISSUED BY"}</h3>
<p class="name">${isAr ? biz.name : biz.nameEn}</p>
<p>CR. ${biz.cr}</p>
<p>${isAr ? biz.building + " " + biz.street : biz.building + " " + biz.streetEn}</p>
<p>${isAr ? biz.district + ", " + biz.city + " " + biz.postal : biz.districtEn + ", " + biz.cityEn + " " + biz.postal}</p>
<p>${isAr ? biz.country : biz.countryEn}</p>
</div>
<div class="detail-box">
<h3>${isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629 \u0625\u0644\u0649" : "INVOICE TO"}</h3>
<p class="name">${invoice.userName || "N/A"}</p>
${invoice.userEmail ? "<p>" + invoice.userEmail + "</p>" : ""}
${invoice.userPhone ? "<p>" + invoice.userPhone + "</p>" : ""}
</div></div>
<table><thead><tr>
<th>${isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "Description"}</th>
<th>${isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "Period"}</th>
<th>${isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Amount"}</th>
</tr></thead><tbody>
<tr><td>${isAr ? "\u0627\u0634\u062A\u0631\u0627\u0643" : "Subscription"} - ${invoice.subscriptionPlan || "Basic"}</td>
<td>${invoice.startDate || ""} - ${invoice.endDate || ""}</td>
<td>${invoice.amount || 0} ${invoice.currency || "SAR"}</td></tr>
<tr class="total-row"><td colspan="2">${isAr ? "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" : "Total"}</td>
<td>${invoice.amount || 0} ${invoice.currency || "SAR"}</td></tr>
</tbody></table>
${invoice.paymentMethod ? '<div class="meta-info"><strong>' + (isAr ? "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639" : "Payment Method") + ":</strong> " + invoice.paymentMethod + "</div>" : ""}
${invoice.notes ? '<div class="meta-info"><strong>' + (isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A" : "Notes") + ":</strong> " + invoice.notes + "</div>" : ""}
<div class="bilingual">
<h4>${isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0624\u0633\u0633\u0629" : "Business Details (Arabic)"}</h4>
<p><strong>${biz.name}</strong></p>
<p>\u0633\u062C\u0644 \u062A\u062C\u0627\u0631\u064A: ${biz.cr}</p>
<p>${biz.building} ${biz.street}, ${biz.district}, ${biz.city} ${biz.postal}</p>
<p>${biz.country}</p>
</div>
</div>
<div class="footer">
<p><strong>${isAr ? biz.name : biz.nameEn}</strong></p>
<p>${isAr ? "\u0633\u062C\u0644 \u062A\u062C\u0627\u0631\u064A" : "CR"}: ${biz.cr} | ${biz.building} ${isAr ? biz.street : biz.streetEn}, ${isAr ? biz.district : biz.districtEn}, ${isAr ? biz.city : biz.cityEn} ${biz.postal}</p>
<p>${isAr ? biz.country : biz.countryEn}</p>
</div>
</div>
<div class="actions">
<button class="btn btn-primary" onclick="window.print()">${isAr ? "\u0637\u0628\u0627\u0639\u0629 / \u062D\u0641\u0638 PDF" : "Print / Save as PDF"}</button>
<button class="btn btn-secondary" onclick="window.close()">${isAr ? "\u0625\u063A\u0644\u0627\u0642" : "Close"}</button>
</div>
</body></html>`;
    }
    __name(generateInvoiceHTML, "generateInvoiceHTML");
    __name2(generateInvoiceHTML, "generateInvoiceHTML");
    function generateInvoiceEmailHTML(invoice, lang) {
      const isAr = lang === "ar";
      const biz = {
        name: "\u0645\u0624\u0633\u0633\u0629 \u0633\u0627\u0644\u0645 \u0628\u0646 \u0639\u0644\u064A \u0627\u0644\u0646\u0639\u064A\u0645\u064A",
        nameEn: "Salem Bin Ali Al-Nuaimi Est.",
        cr: "7050191290",
        building: "2500",
        streetEn: "Ahmad bin Hajar Al-Asqalani",
        districtEn: "Taibah District",
        cityEn: "Jubail",
        postal: "35513",
        countryEn: "Kingdom of Saudi Arabia"
      };
      const dir = isAr ? "rtl" : "ltr";
      const invoiceNum = invoice.invoiceNumber || "";
      const created = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString(isAr ? "ar-SA" : "en-US") : "";
      return `<div dir="${dir}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f0f0f0;padding:20px">
<div style="background:#fff;border-radius:12px;overflow:visible">
<div style="background:#e8722a;padding:30px 30px 55px;border-radius:12px 12px 0 0;position:relative;text-align:center">
<table width="100%" cellpadding="0" cellspacing="0" style="position:relative;z-index:1"><tr>
<td style="width:33%"></td>
<td style="width:34%;text-align:center">
<div style="width:100px;height:100px;background:#fff;border-radius:50%;margin:0 auto;display:block;box-shadow:0 4px 16px rgba(0,0,0,0.15);overflow:hidden">
<img src="${LOGO_URL}" alt="Tabbakheen" width="72" height="72" style="display:block;margin:14px auto;object-fit:contain">
</div>
</td>
<td style="width:33%;text-align:${isAr ? "left" : "right"};vertical-align:top;color:#fff">
<div style="font-size:18px;font-weight:700;opacity:.95">${isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629" : "Invoice"}</div>
<div style="font-size:11px;opacity:.9;margin-top:4px">#${invoiceNum}</div>
<div style="font-size:11px;opacity:.9;margin-top:2px">${isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date"}: ${created}</div>
</td>
</tr></table>
</div>
<div style="text-align:center;padding:10px 30px 16px">
<h1 style="font-size:22px;color:#e8722a;margin:0 0 2px;font-weight:700">Tabbakheen</h1>
<p style="font-size:13px;color:#888;margin:0">\u0637\u0628\u0627\u062E\u064A\u0646</p>
</div>
<div style="padding:0 30px 24px">
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>
<td style="width:48%;vertical-align:top;background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e8ecf0">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#e8722a;font-weight:700;margin-bottom:8px">${isAr ? "\u0635\u0627\u062F\u0631\u0629 \u0645\u0646" : "ISSUED BY"}</div>
<div style="font-size:13px;font-weight:700;color:#222;margin-bottom:3px">${isAr ? biz.name : biz.nameEn}</div>
<div style="font-size:12px;color:#555">CR. ${biz.cr}</div>
<div style="font-size:12px;color:#555">${biz.building} ${biz.streetEn}</div>
<div style="font-size:12px;color:#555">${biz.districtEn}, ${biz.cityEn} ${biz.postal}</div>
</td>
<td style="width:4%"></td>
<td style="width:48%;vertical-align:top;background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e8ecf0">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#e8722a;font-weight:700;margin-bottom:8px">${isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629 \u0625\u0644\u0649" : "INVOICE TO"}</div>
<div style="font-size:13px;font-weight:700;color:#222;margin-bottom:3px">${invoice.userName || ""}</div>
${invoice.userEmail ? '<div style="font-size:12px;color:#555">' + invoice.userEmail + "</div>" : ""}
${invoice.userPhone ? '<div style="font-size:12px;color:#555">' + invoice.userPhone + "</div>" : ""}
</td>
</tr></table>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr style="background:#f1f5f9"><th style="padding:10px 14px;text-align:${isAr ? "right" : "left"};font-size:11px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">${isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "Description"}</th><th style="padding:10px 14px;text-align:${isAr ? "right" : "left"};font-size:11px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">${isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "Period"}</th><th style="padding:10px 14px;text-align:${isAr ? "right" : "left"};font-size:11px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">${isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Amount"}</th></tr>
<tr><td style="padding:12px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${isAr ? "\u0627\u0634\u062A\u0631\u0627\u0643" : "Subscription"} - ${invoice.subscriptionPlan || "Basic"}</td><td style="padding:12px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${invoice.startDate || ""} - ${invoice.endDate || ""}</td><td style="padding:12px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${invoice.amount || 0} ${invoice.currency || "SAR"}</td></tr>
<tr style="background:#fff8f0"><td colspan="2" style="padding:12px 14px;font-size:14px;font-weight:700;border-top:2px solid #e8722a;color:#333">${isAr ? "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" : "Total"}</td><td style="padding:12px 14px;font-size:15px;font-weight:700;border-top:2px solid #e8722a;color:#e8722a">${invoice.amount || 0} ${invoice.currency || "SAR"}</td></tr>
</table>
${invoice.paymentMethod ? '<div style="font-size:12px;color:#555;margin:8px 0"><strong>' + (isAr ? "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639" : "Payment Method") + ":</strong> " + invoice.paymentMethod + "</div>" : ""}
${invoice.notes ? '<div style="font-size:12px;color:#555;margin:8px 0"><strong>' + (isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A" : "Notes") + ":</strong> " + invoice.notes + "</div>" : ""}
</div>
<div style="padding:16px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#888;text-align:center;border-radius:0 0 12px 12px">
<p style="margin:2px 0"><strong>${isAr ? biz.name : biz.nameEn}</strong></p>
<p style="margin:2px 0">CR: ${biz.cr} | ${biz.building} ${biz.streetEn}, ${biz.districtEn}, ${biz.cityEn} ${biz.postal}</p>
<p style="margin:2px 0">${biz.countryEn}</p>
</div>
</div>
</div>`;
    }
    __name(generateInvoiceEmailHTML, "generateInvoiceEmailHTML");
    __name2(generateInvoiceEmailHTML, "generateInvoiceEmailHTML");
    function getAdminHTML() {
      return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Tabbakheen Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--primary:#0d9488;--primary-dark:#0f766e;--bg:#f1f5f9;--sidebar:#0f172a;--sidebar-hover:#1e293b;--card:#fff;--text:#0f172a;--text2:#64748b;--text3:#94a3b8;--border:#e2e8f0;--success:#10b981;--warning:#f59e0b;--error:#ef4444;--info:#3b82f6;--orange:#e8722a;--radius:12px}
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
#login-view{display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%)}
.login-card{background:var(--card);border-radius:16px;padding:40px;width:380px;max-width:90vw;box-shadow:0 25px 50px rgba(0,0,0,0.25)}
.login-logo{text-align:center;margin-bottom:24px}
.login-logo h1{font-size:24px;color:var(--orange);margin-bottom:4px}
.login-logo p{color:var(--text2);font-size:14px}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;outline:none;transition:border .2s}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--primary)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-primary{background:var(--primary);color:#fff}.btn-primary:hover{background:var(--primary-dark)}
.btn-success{background:var(--success);color:#fff}.btn-success:hover{opacity:.9}
.btn-warning{background:var(--warning);color:#fff}.btn-warning:hover{opacity:.9}
.btn-danger{background:var(--error);color:#fff}.btn-danger:hover{opacity:.9}
.btn-secondary{background:var(--border);color:var(--text)}.btn-secondary:hover{background:#cbd5e1}
.btn-orange{background:var(--orange);color:#fff}.btn-orange:hover{opacity:.9}
.btn-sm{padding:6px 12px;font-size:12px;border-radius:6px}
.btn-block{width:100%;padding:12px}
.btn:disabled{opacity:.5;cursor:not-allowed}
 .err-msg{background:#fef2f2;color:var(--error);padding:10px;border-radius:8px;font-size:13px;margin-bottom:12px;display:none}
 .login-status{min-height:18px;margin:10px 0 0;font-size:13px;text-align:center;color:var(--text2)}
 .login-status.error{color:var(--error)}.login-status.success{color:var(--success)}.login-status.loading{color:var(--info)}
.success-msg{background:#d1fae5;color:#065f46;padding:10px;border-radius:8px;font-size:13px;margin-bottom:12px;display:none}
#main-view{display:none}
.layout{display:flex;min-height:100vh}
.sidebar{width:240px;background:var(--sidebar);padding:20px 0;display:flex;flex-direction:column;position:fixed;top:0;bottom:0;z-index:100;visibility:hidden;transform:translateX(-100%);transition:none;pointer-events:none}
html[dir="rtl"] .sidebar{right:0;left:auto;transform:translateX(100%)}html[dir="ltr"] .sidebar{left:0;right:auto}
.sidebar.animated{transition:transform .3s cubic-bezier(.4,0,.2,1),visibility .3s}
.sidebar-logo{padding:0 20px 24px;border-bottom:1px solid rgba(255,255,255,.08)}
.sidebar-logo h2{color:var(--orange);font-size:18px}
.sidebar-logo span{color:var(--text3);font-size:12px}
.sidebar-nav{flex:1;padding:16px 0}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 20px;color:var(--text3);font-size:14px;cursor:pointer;transition:all .15s;border-left:3px solid transparent}
html[dir="rtl"] .nav-item{border-left:none;border-right:3px solid transparent}
.nav-item:hover{background:var(--sidebar-hover);color:#fff}
.nav-item.active{background:var(--sidebar-hover);color:#fff;border-left-color:var(--primary)}
html[dir="rtl"] .nav-item.active{border-left-color:transparent;border-right-color:var(--primary)}
.nav-item svg{width:18px;height:18px;flex-shrink:0}
.sidebar-footer{padding:16px 20px;border-top:1px solid rgba(255,255,255,.08)}
.sidebar-footer .nav-item{padding:10px 0}
.main{flex:1;padding:24px 32px;min-height:100vh}
html[dir="rtl"] .main{margin-right:240px}html[dir="ltr"] .main{margin-left:240px}
.page-title{font-size:24px;font-weight:700;margin-bottom:24px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:32px}
.stat-card{background:var(--card);border-radius:var(--radius);padding:20px;border-top:4px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,.06);cursor:pointer;transition:transform .15s}
.stat-card:hover{transform:translateY(-2px)}
.stat-card .label{font-size:13px;color:var(--text2);margin-bottom:8px}
.stat-card .value{font-size:28px;font-weight:700}
.stat-card.blue{border-top-color:var(--info)}.stat-card.blue .value{color:var(--info)}
.stat-card.green{border-top-color:var(--success)}.stat-card.green .value{color:var(--success)}
.stat-card.orange{border-top-color:var(--orange)}.stat-card.orange .value{color:var(--orange)}
.stat-card.purple{border-top-color:#8b5cf6}.stat-card.purple .value{color:#8b5cf6}
.stat-card.amber{border-top-color:var(--warning)}.stat-card.amber .value{color:var(--warning)}
.stat-card.red{border-top-color:var(--error)}.stat-card.red .value{color:var(--error)}
.stat-card.teal{border-top-color:var(--primary)}.stat-card.teal .value{color:var(--primary)}
.stat-card.selected{outline:2px solid var(--orange);outline-offset:-2px}
.stat-label{font-size:13px;color:var(--text2);margin-bottom:8px}.stat-value{font-size:28px;font-weight:700;color:var(--text)}
.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:18px}
.detail-grid label{display:block;font-size:12px;color:var(--text2);margin-bottom:4px}
.detail-grid strong{font-size:14px;overflow-wrap:anywhere}
.filters{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
.filters select,.filters input{padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--card)}
.filters input{min-width:200px}
.table-wrap{background:var(--card);border-radius:var(--radius);overflow:auto;box-shadow:0 1px 3px rgba(0,0,0,.06)}
table{width:100%;border-collapse:collapse}
th{background:#f8fafc;padding:12px 16px;font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
html[dir="rtl"] th{text-align:right}html[dir="ltr"] th{text-align:left}
td{padding:12px 16px;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
tr:hover td{background:#f8fafc}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge-green{background:#d1fae5;color:#065f46}
.badge-blue{background:#dbeafe;color:#1e40af}
.badge-yellow{background:#fef3c7;color:#92400e}
.badge-red{background:#fee2e2;color:#991b1b}
.badge-gray{background:#f3f4f6;color:#374151}
.badge-purple{background:#ede9fe;color:#5b21b6}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border-radius:16px;padding:28px;width:600px;max-width:92vw;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px rgba(0,0,0,.2)}
.modal h3{font-size:18px;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);flex-wrap:wrap}
.toggle{display:flex;align-items:center;gap:10px;cursor:pointer}
.toggle input{width:18px;height:18px;accent-color:var(--primary)}
.settings-section{background:var(--card);border-radius:var(--radius);padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.settings-section h3{font-size:16px;font-weight:600;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.banner-preview{width:100%;max-width:400px;aspect-ratio:16/7;object-fit:cover;border-radius:8px;border:1px solid var(--border);margin-bottom:12px;background:#f1f5f9}
.upload-row{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.file-input{font-size:13px}
.loading{text-align:center;padding:40px;color:var(--text2)}
.empty{text-align:center;padding:40px;color:var(--text3)}
.user-info-row{display:flex;gap:8px;align-items:center;margin-bottom:4px}
.user-info-row .name{font-weight:600;color:var(--text)}
.user-info-row .email{color:var(--text2);font-size:12px}
.toast{position:fixed;top:20px;z-index:999;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;font-weight:500;opacity:0;transform:translateY(-10px);transition:all .3s}
html[dir="rtl"] .toast{left:20px}html[dir="ltr"] .toast{right:20px}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{background:var(--success)}.toast.error{background:var(--error)}
.lang-switch{display:flex;border:1.5px solid var(--border);border-radius:8px;overflow:hidden}
.lang-switch button{padding:6px 16px;border:none;background:var(--bg);font-size:13px;cursor:pointer;font-weight:500}
.lang-switch button.active{background:var(--primary);color:#fff}
.sub-warn{color:var(--warning);font-weight:600;font-size:12px}
.sub-expired{color:var(--error);font-weight:600;font-size:12px}
.sub-active{color:var(--success);font-weight:600;font-size:12px}
.drill-section{background:var(--card);border-radius:var(--radius);padding:20px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.drill-section h3{margin-bottom:16px;font-size:16px}
.drill-close{float:right;cursor:pointer;color:var(--text2);font-size:18px;line-height:1}
html[dir="rtl"] .drill-close{float:left}
.img-thumb{width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer}
.img-modal{max-width:90vw;max-height:80vh;border-radius:8px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.inv-list-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:#fafbfc}
.inv-list-item .inv-info{flex:1}
.inv-list-item .inv-info .inv-num{font-weight:600;font-size:14px;color:var(--text)}
.inv-list-item .inv-info .inv-detail{font-size:12px;color:var(--text2);margin-top:2px}
.inv-list-item .inv-actions{display:flex;gap:6px;flex-wrap:wrap}
.mobile-header{display:none;position:fixed;top:0;left:0;right:0;height:56px;background:var(--sidebar);z-index:90;align-items:center;padding:0 16px;gap:12px}
.mobile-header .hamburger{background:none;border:none;color:#fff;font-size:26px;cursor:pointer;padding:8px;line-height:1;border-radius:6px;width:42px;height:42px;display:flex;align-items:center;justify-content:center}
.mobile-header .hamburger:hover{background:var(--sidebar-hover)}
.mobile-header .page-name{color:#fff;font-size:16px;font-weight:600;flex:1}
.mobile-header .logo-sm{color:var(--orange);font-size:15px;font-weight:700}
.sidebar-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:95;opacity:0;transition:opacity .3s ease;pointer-events:none}
.sidebar-backdrop.show{display:block;opacity:1;pointer-events:auto}
@media(min-width:769px){
  .sidebar{visibility:visible!important;transform:translateX(0)!important;pointer-events:auto!important}
}
@media(max-width:1024px){
  .stats-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
  .main{padding:20px 18px}
}
@media(max-width:768px){
  .mobile-header{display:flex}
  .sidebar{position:fixed;width:270px;top:0;bottom:0;z-index:100;visibility:hidden!important;pointer-events:none!important}
  .sidebar.open{transform:translateX(0)!important;visibility:visible!important;pointer-events:auto!important}
  html[dir="rtl"] .main{margin-right:0}html[dir="ltr"] .main{margin-left:0}
  .main{padding:16px;padding-top:72px;width:100%}
  .stats-grid{grid-template-columns:repeat(2,1fr);gap:10px}
  .filters{flex-direction:column;gap:8px}.filters select,.filters input{width:100%}
  .grid-2{grid-template-columns:1fr}
  .detail-grid{grid-template-columns:1fr;gap:10px}
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}
  .table-wrap table{min-width:640px}
  .page-title{font-size:20px;margin-bottom:16px}
  .modal{width:95vw;padding:20px;max-height:85vh}
  .modal h3{font-size:16px;margin-bottom:14px}
  .modal-actions{flex-direction:column;gap:8px}.modal-actions .btn{width:100%}
  .settings-section{padding:16px;margin-bottom:14px}
  .stat-card .value{font-size:22px}
  .stat-card{padding:16px}
  .drill-section{padding:12px;margin-top:12px}
  .banner-preview{max-width:100%}
  .login-card{width:92vw;padding:28px}
}
@media(max-width:480px){
  .stats-grid{grid-template-columns:1fr;gap:8px}
  .main{padding:10px;padding-top:66px}
  .stat-card .value{font-size:20px}
  .stat-card{padding:14px}
  .page-title{font-size:18px}
  .btn{padding:8px 14px;font-size:13px}
  .modal{padding:16px;border-radius:12px}
  .form-group input,.form-group select,.form-group textarea{padding:9px 12px;font-size:13px}
  .form-group label{font-size:12px}
}
</style>
</head>
<body>

<div id="login-view">
  <div class="login-card">
    <div class="login-logo">
      <h1>Tabbakheen</h1>
       <p id="login-subtitle">\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0637\u0628\u0627\u062E\u064A\u0646</p>
    </div>
    <form id="login-form" onsubmit="doLogin(event);return false;">
      <div id="login-error" class="err-msg"></div>
      <div class="form-group">
        <label id="login-pw-label">\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0627\u0644\u0645\u0633\u0624\u0648\u0644</label>
        <input type="password" id="login-password" autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary btn-block" id="login-btn">\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644</button>
      <div id="login-status" class="login-status" role="status" aria-live="polite"></div>
    </form>
  </div>
</div>

<div id="main-view">
  <div class="layout">
    <div class="mobile-header" id="mobile-header">
      <button class="hamburger" onclick="toggleSidebar()" aria-label="Menu">\u2630</button>
      <span class="page-name" id="mobile-page-name"></span>
      <span class="logo-sm">Tabbakheen</span>
    </div>
    <div class="sidebar-backdrop" id="sidebar-backdrop" onclick="closeSidebar()"></div>
    <div class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <h2>Tabbakheen</h2>
        <span id="sidebar-subtitle"></span>
      </div>
      <div class="sidebar-nav">
        <div class="nav-item active" data-page="dashboard" onclick="navigate('dashboard')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <span id="nav-dashboard"></span>
        </div>
        <div class="nav-item" data-page="users" onclick="navigate('users')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span id="nav-users"></span>
        </div>
        <div class="nav-item" data-page="complaints" onclick="navigate('complaints')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>
          <span id="nav-complaints"></span>
        </div>
        <div class="nav-item" data-page="verification" onclick="navigate('verification')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          <span id="nav-verification"></span>
        </div>
        <div class="nav-item" data-page="invoices" onclick="navigate('invoices')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <span id="nav-invoices"></span>
        </div>
        <div class="nav-item" data-page="settings" onclick="navigate('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span id="nav-settings"></span>
        </div>
        <div class="nav-item" data-page="notifications" onclick="navigate('notifications')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span id="nav-notifications"></span>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="nav-item" onclick="doLogout()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span id="nav-logout"></span>
        </div>
      </div>
    </div>
    <div class="main">
      <div id="page-content"></div>
    </div>
  </div>
</div>

<div id="modal-overlay" class="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modal-content"></div>
</div>

<div id="toast" class="toast"></div>

<script>
var T={ar:{adminDashboard:"\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0637\u0628\u0627\u062E\u064A\u0646",adminPanel:"\u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629",adminPassword:"\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0627\u0644\u0645\u0633\u0624\u0648\u0644",signIn:"\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644",invalidPassword:"\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629",connectionError:"\u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0627\u062A\u0635\u0627\u0644",enterPassword:"\u0623\u062F\u062E\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",dashboard:"\u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645",users:"\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",invoices:"\u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631",settings:"\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",logout:"\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C",totalUsers:"\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",customers:"\u0627\u0644\u0639\u0645\u0644\u0627\u0621",providers:"\u0645\u0642\u062F\u0645\u064A \u0627\u0644\u062E\u062F\u0645\u0629",drivers:"\u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646",providersInTrial:"\u0645\u0642\u062F\u0645\u064A\u0646 \u0641\u064A \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A",driversInTrial:"\u0633\u0627\u0626\u0642\u064A\u0646 \u0641\u064A \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A",suspended:"\u0645\u0648\u0642\u0648\u0641\u064A\u0646",activeSubs:"\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A \u0641\u0639\u0627\u0644\u0629",loading:"\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...",noData:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A",name:"\u0627\u0644\u0627\u0633\u0645",email:"\u0627\u0644\u0628\u0631\u064A\u062F",phone:"\u0627\u0644\u062C\u0648\u0627\u0644",totalOrders:"\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0637\u0644\u0628\u0627\u062A",delivered:"\u0645\u0643\u062A\u0645\u0644",canceled:"\u0645\u0644\u063A\u064A",rating:"\u0627\u0644\u062A\u0642\u064A\u064A\u0645",images:"\u0627\u0644\u0635\u0648\u0631",allRoles:"\u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u062F\u0648\u0627\u0631",customer:"\u0639\u0645\u064A\u0644",provider:"\u0645\u0642\u062F\u0645 \u062E\u062F\u0645\u0629",driver:"\u0633\u0627\u0626\u0642",allStatus:"\u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0627\u0644\u0627\u062A",active:"\u0641\u0639\u0627\u0644",trial:"\u062A\u062C\u0631\u064A\u0628\u064A",disabled:"\u0645\u0639\u0637\u0644",allSubs:"\u062C\u0645\u064A\u0639 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A",trialing:"\u062A\u062C\u0631\u064A\u0628\u064A",expired:"\u0645\u0646\u062A\u0647\u064A",canceledSub:"\u0645\u0644\u063A\u064A",pastDue:"\u0645\u062A\u0623\u062E\u0631",searchPlaceholder:"\u0628\u062D\u062B \u0628\u0627\u0644\u0627\u0633\u0645\u060C \u0627\u0644\u0628\u0631\u064A\u062F\u060C \u0627\u0644\u062C\u0648\u0627\u0644...",edit:"\u062A\u0639\u062F\u064A\u0644",noUsersFound:"\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",user:"\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",role:"\u0627\u0644\u062F\u0648\u0631",account:"\u0627\u0644\u062D\u0633\u0627\u0628",subscription:"\u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",created:"\u0627\u0644\u0625\u0646\u0634\u0627\u0621",actions:"\u0625\u062C\u0631\u0627\u0621\u0627\u062A",subStatus:"\u062D\u0627\u0644\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",editUser:"\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",accountStatus:"\u062D\u0627\u0644\u0629 \u0627\u0644\u062D\u0633\u0627\u0628",subscriptionStatus:"\u062D\u0627\u0644\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",subscriptionPlan:"\u062E\u0637\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",trialEndsAt:"\u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A",subscriptionEndsAt:"\u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",activatedByAdmin:"\u0645\u0641\u0639\u0644 \u0628\u0648\u0627\u0633\u0637\u0629 \u0627\u0644\u0645\u0633\u0624\u0648\u0644",disabledReason:"\u0633\u0628\u0628 \u0627\u0644\u062A\u0639\u0637\u064A\u0644",cancel:"\u0625\u0644\u063A\u0627\u0621",activate:"\u062A\u0641\u0639\u064A\u0644",suspend:"\u0625\u064A\u0642\u0627\u0641",save:"\u062D\u0641\u0638",userUpdated:"\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",failedUpdate:"\u0641\u0634\u0644 \u0627\u0644\u062A\u062D\u062F\u064A\u062B",noChanges:"\u0644\u0627 \u062A\u0648\u062C\u062F \u062A\u063A\u064A\u064A\u0631\u0627\u062A",notSet:"\u063A\u064A\u0631 \u0645\u062D\u062F\u062F",expiringIn:"\u064A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644",days:"\u064A\u0648\u0645",daysRemaining:"\u064A\u0648\u0645 \u0645\u062A\u0628\u0642\u064A",appSettings:"\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642",homeBanner:"\u0628\u0627\u0646\u0631 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629",upload:"\u0631\u0641\u0639",uploading:"\u062C\u0627\u0631\u064A \u0627\u0644\u0631\u0641\u0639...",uploadSuccess:"\u062A\u0645 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0646\u062C\u0627\u062D",uploadFailed:"\u0641\u0634\u0644 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629",bannerUrl:"\u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629 \u0627\u0644\u0628\u0627\u0646\u0631",bannerEnabled:"\u0627\u0644\u0628\u0627\u0646\u0631 \u0645\u0641\u0639\u0644",noBanner:"\u0644\u0627 \u064A\u0648\u062C\u062F \u0628\u0627\u0646\u0631",supportContact:"\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u0639\u0645",supportEmail:"\u0628\u0631\u064A\u062F \u0627\u0644\u062F\u0639\u0645",supportWhatsapp:"\u0648\u0627\u062A\u0633\u0627\u0628 \u0627\u0644\u062F\u0639\u0645",deliveryPricing:"\u062A\u0633\u0639\u064A\u0631 \u0627\u0644\u062A\u0648\u0635\u064A\u0644",baseFee:"\u0631\u0633\u0645 \u0623\u0633\u0627\u0633\u064A (SAR)",perKmCity:"\u0633\u0639\u0631 \u0627\u0644\u0643\u064A\u0644\u0648\u0645\u062A\u0631 (SAR)",minFee:"\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 (SAR)",maxFee:"\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 (SAR)",formulaPreview:"\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0635\u064A\u063A\u0629",distance:"\u0627\u0644\u0645\u0633\u0627\u0641\u0629",estimatedFee:"\u0627\u0644\u0631\u0633\u0645 \u0627\u0644\u0645\u062A\u0648\u0642\u0639",pricingFormula:"\u0627\u0644\u0635\u064A\u063A\u0629: \u0631\u0633\u0645 \u0623\u0633\u0627\u0633\u064A + (\u0645\u0633\u0627\u0641\u0629 \xD7 \u0633\u0639\u0631/\u0643\u0645)",invalidMinMax:"\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0623\u0642\u0644 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649",noNegative:"\u0627\u0644\u0642\u064A\u0645 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0635\u0641\u0631",saveSettings:"\u062D\u0641\u0638 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",settingsSaved:"\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",failedSave:"\u0641\u0634\u0644 \u0627\u0644\u062D\u0641\u0638",language:"\u0627\u0644\u0644\u063A\u0629",arabic:"\u0627\u0644\u0639\u0631\u0628\u064A\u0629",english:"English",changePassword:"\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",currentPassword:"\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062D\u0627\u0644\u064A\u0629",newPassword:"\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629",confirmNewPassword:"\u062A\u0623\u0643\u064A\u062F \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",changePasswordBtn:"\u062A\u063A\u064A\u064A\u0631",passwordChanged:"\u062A\u0645 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",passwordMismatch:"\u0643\u0644\u0645\u0627\u062A \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0645\u062A\u0637\u0627\u0628\u0642\u0629",passwordFailed:"\u0641\u0634\u0644 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",adminNotifications:"\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0633\u0624\u0648\u0644",notifyNewUser:"\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u062A\u0633\u062C\u064A\u0644 \u0639\u0645\u064A\u0644 \u062C\u062F\u064A\u062F",notifyNewProvider:"\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u062A\u0633\u062C\u064A\u0644 \u0645\u0642\u062F\u0645 \u062E\u062F\u0645\u0629 \u062C\u062F\u064A\u062F",notifyNewDriver:"\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u062A\u0633\u062C\u064A\u0644 \u0633\u0627\u0626\u0642 \u062C\u062F\u064A\u062F",verification:"\u0627\u0644\u062A\u0648\u062B\u064A\u0642",crVerifications:"\u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u062A\u062C\u0627\u0631\u064A",freelanceRequests:"\u0637\u0644\u0628\u0627\u062A \u0634\u0647\u0627\u062F\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u062D\u0631",certNumber:"\u0631\u0642\u0645 \u0627\u0644\u0634\u0647\u0627\u062F\u0629",submittedAt:"\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0642\u062F\u064A\u0645",reviewStatus:"\u062D\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629",approve:"\u0627\u0639\u062A\u0645\u0627\u062F",reject:"\u0631\u0641\u0636",pendingReview:"\u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629",verifiedStatus:"\u0645\u0648\u062B\u0651\u0642",unverifiedStatus:"\u063A\u064A\u0631 \u0645\u0648\u062B\u0651\u0642",notVerified:"\u063A\u064A\u0631 \u0645\u0648\u062B\u0651\u0642",viewDocument:"\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0648\u062B\u064A\u0642\u0629",viewImage:"\u0639\u0631\u0636 \u0627\u0644\u0635\u0648\u0631\u0629",rejectReason:"\u0633\u0628\u0628 \u0627\u0644\u0631\u0641\u0636 (\u062F\u0627\u062E\u0644\u064A)",verificationApproved:"\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0648\u062B\u064A\u0642",verificationRejected:"\u062A\u0645 \u0631\u0641\u0636 \u0627\u0644\u062A\u0648\u062B\u064A\u0642",notifyCrVerification:"\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u062A\u0648\u062B\u064A\u0642 \u0633\u062C\u0644 \u062A\u062C\u0627\u0631\u064A \u062C\u062F\u064A\u062F",notifyFreelanceRequest:"\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u0637\u0644\u0628 \u0634\u0647\u0627\u062F\u0629 \u0639\u0645\u0644 \u062D\u0631 \u062C\u062F\u064A\u062F",noVerificationData:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u062A\u0648\u062B\u064A\u0642",source:"\u0627\u0644\u0645\u0635\u062F\u0631",subWarning:"\u062A\u0646\u0628\u064A\u0647 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",warningDays:"\u0623\u064A\u0627\u0645 \u0627\u0644\u062A\u0646\u0628\u064A\u0647 \u0642\u0628\u0644 \u0627\u0644\u0627\u0646\u062A\u0647\u0627\u0621",sendReminder:"\u0625\u0631\u0633\u0627\u0644 \u062A\u0630\u0643\u064A\u0631",reminderSent:"\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u062A\u0630\u0643\u064A\u0631",addSubscription:"\u0625\u0636\u0627\u0641\u0629 \u0627\u0634\u062A\u0631\u0627\u0643",amount:"\u0627\u0644\u0645\u0628\u0644\u063A",startDate:"\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0628\u062F\u0627\u064A\u0629",endDate:"\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0646\u0647\u0627\u064A\u0629",paymentMethod:"\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639",planName:"\u0627\u0633\u0645 \u0627\u0644\u062E\u0637\u0629",notes:"\u0645\u0644\u0627\u062D\u0638\u0627\u062A",generateInvoice:"\u0625\u0646\u0634\u0627\u0621 \u0641\u0627\u062A\u0648\u0631\u0629",viewInvoice:"\u0639\u0631\u0636 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629",downloadPdf:"\u062A\u062D\u0645\u064A\u0644 PDF",sendByEmail:"\u0625\u0631\u0633\u0627\u0644 \u0628\u0627\u0644\u0628\u0631\u064A\u062F",invoiceSaved:"\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629",invoiceSent:"\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629",invoiceEmailFailed:"\u0641\u0634\u0644 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629",noInvoices:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0641\u0648\u0627\u062A\u064A\u0631",invoiceNumber:"\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629",date:"\u0627\u0644\u062A\u0627\u0631\u064A\u062E",close:"\u0625\u063A\u0644\u0627\u0642",selectFile:"\u0627\u062E\u062A\u0631 \u0645\u0644\u0641",noName:"\u0628\u062F\u0648\u0646 \u0627\u0633\u0645",na:"\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631",clickToExpand:"\u0627\u0636\u063A\u0637 \u0644\u0644\u062A\u0641\u0627\u0635\u064A\u0644",status:"\u0627\u0644\u062D\u0627\u0644\u0629",issued:"\u0635\u0627\u062F\u0631\u0629",allInvoices:"\u062C\u0645\u064A\u0639 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631",notifications:"\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A",broadcastTitle:"\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0625\u0634\u0639\u0627\u0631",broadcastMessage:"\u0646\u0635 \u0627\u0644\u0625\u0634\u0639\u0627\u0631",broadcastAudience:"\u0627\u0644\u062C\u0645\u0647\u0648\u0631 \u0627\u0644\u0645\u0633\u062A\u0647\u062F\u0641",audienceCustomers:"\u0627\u0644\u0639\u0645\u0644\u0627\u0621",audienceProviders:"\u0645\u0642\u062F\u0645\u0648 \u0627\u0644\u062E\u062F\u0645\u0629",audienceDrivers:"\u0645\u0646\u0627\u062F\u064A\u0628 \u0627\u0644\u062A\u0648\u0635\u064A\u0644",audienceAll:"\u0627\u0644\u0643\u0644",broadcastSend:"\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631",broadcastHistory:"\u0633\u062C\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A",broadcastConfirm:"\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0625\u0631\u0633\u0627\u0644",broadcastConfirmMsg:"\u0647\u0644 \u0623\u0646\u062A \u0645\u062A\u0623\u0643\u062F\u061F \u0633\u064A\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0647\u0630\u0627 \u0627\u0644\u0625\u0634\u0639\u0627\u0631 \u0644\u062C\u0645\u064A\u0639 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0627\u0644\u0645\u062D\u062F\u062F\u064A\u0646.",broadcastResult:"\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",broadcastMatched:"\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646 \u0645\u0637\u0627\u0628\u0642\u0648\u0646",broadcastTokens:"\u0631\u0645\u0648\u0632 \u0635\u0627\u0644\u062D\u0629",broadcastSentCount:"\u062A\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",broadcastFailed:"\u0641\u0634\u0644 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",noBroadcastHistory:"\u0644\u0627 \u064A\u0648\u062C\u062F \u0633\u062C\u0644 \u0625\u0634\u0639\u0627\u0631\u0627\u062A",broadcastAudienceLabel:"\u0627\u0644\u062C\u0645\u0647\u0648\u0631",deleteNotif:"\u062D\u0630\u0641",resendNotif:"\u0625\u0639\u0627\u062F\u0629 \u0625\u0631\u0633\u0627\u0644",editResend:"\u062A\u0639\u062F\u064A\u0644 \u0648\u0625\u0639\u0627\u062F\u0629 \u0625\u0631\u0633\u0627\u0644",editResendSend:"\u0625\u0631\u0633\u0627\u0644 \u0646\u0633\u062E\u0629 \u0645\u0639\u062F\u0644\u0629",confirmDelete:"\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062D\u0630\u0641",confirmDeleteMsg:"\u0647\u0644 \u0623\u0646\u062A \u0645\u062A\u0623\u0643\u062F\u061F \u0633\u064A\u062A\u0645 \u062D\u0630\u0641 \u0633\u062C\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631 \u0641\u0642\u0637 \u062F\u0648\u0646 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0631\u0633\u0644\u0629.",confirmResend:"\u062A\u0623\u0643\u064A\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",confirmResendMsg:"\u0647\u0644 \u0623\u0646\u062A \u0645\u062A\u0623\u0643\u062F\u061F \u0633\u064A\u062A\u0645 \u0625\u0639\u0627\u062F\u0629 \u0625\u0631\u0633\u0627\u0644 \u0647\u0630\u0627 \u0627\u0644\u0625\u0634\u0639\u0627\u0631 \u0644\u0644\u062C\u0645\u0647\u0648\u0631 \u0627\u0644\u0645\u062D\u062F\u062F.",notifDeleted:"\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0633\u062C\u0644",deleteFailed:"\u0641\u0634\u0644 \u0627\u0644\u062D\u0630\u0641",resendSuccess:"\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",resendFailed:"\u0641\u0634\u0644\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",providerSubSettings:"\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0634\u062A\u0631\u0627\u0643 \u0645\u0632\u0648\u062F \u0627\u0644\u062E\u062F\u0645\u0629",driverSubSettings:"\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0633\u0627\u0626\u0642",subActive:"\u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0645\u0641\u0639\u0651\u0644",subPrice:"\u0633\u0639\u0631 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 (SAR)",subPeriod:"\u0641\u062A\u0631\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",periodWeekly:"\u0623\u0633\u0628\u0648\u0639\u064A",periodMonthly:"\u0634\u0647\u0631\u064A",periodQuarterly:"\u0631\u0628\u0639 \u0633\u0646\u0648\u064A",periodYearly:"\u0633\u0646\u0648\u064A",freeTrialEnabledLabel:"\u0627\u0644\u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629 \u0645\u0641\u0639\u0651\u0644\u0629",freeTrialTextArLabel:"\u0646\u0635 \u0627\u0644\u062A\u062C\u0631\u0628\u0629 (\u0639\u0631\u0628\u064A)",freeTrialTextEnLabel:"\u0646\u0635 \u0627\u0644\u062A\u062C\u0631\u0628\u0629 (\u0625\u0646\u062C\u0644\u064A\u0632\u064A)"},en:{adminDashboard:"Tabbakheen Admin",adminPanel:"Admin Panel",adminPassword:"Admin Password",signIn:"Sign In",invalidPassword:"Invalid password",connectionError:"Connection error",enterPassword:"Enter admin password",dashboard:"Dashboard",users:"Users",invoices:"Invoices",settings:"Settings",logout:"Logout",totalUsers:"Total Users",customers:"Customers",providers:"Providers",drivers:"Drivers",providersInTrial:"Providers in Trial",driversInTrial:"Drivers in Trial",suspended:"Suspended",activeSubs:"Active Subscriptions",loading:"Loading...",noData:"No data",name:"Name",email:"Email",phone:"Phone",totalOrders:"Total Orders",delivered:"Delivered",canceled:"Canceled",rating:"Rating",images:"Images",allRoles:"All Roles",customer:"Customer",provider:"Provider",driver:"Driver",allStatus:"All Status",active:"Active",trial:"Trial",disabled:"Disabled",allSubs:"All Subscriptions",trialing:"Trialing",expired:"Expired",canceledSub:"Canceled",pastDue:"Past Due",searchPlaceholder:"Search name, email, phone...",edit:"Edit",noUsersFound:"No users found",user:"User",role:"Role",account:"Account",subscription:"Subscription",created:"Created",actions:"Actions",subStatus:"Sub Status",editUser:"Edit User",accountStatus:"Account Status",subscriptionStatus:"Subscription Status",subscriptionPlan:"Subscription Plan",trialEndsAt:"Trial Ends At",subscriptionEndsAt:"Subscription Ends At",activatedByAdmin:"Activated by Admin",disabledReason:"Disabled Reason",cancel:"Cancel",activate:"Activate",suspend:"Suspend",save:"Save",userUpdated:"User updated",failedUpdate:"Failed to update",noChanges:"No changes",notSet:"Not Set",expiringIn:"Expiring in",days:"days",daysRemaining:"days remaining",appSettings:"App Settings",homeBanner:"Home Banner",upload:"Upload",uploading:"Uploading...",uploadSuccess:"Image uploaded successfully",uploadFailed:"Image upload failed",bannerUrl:"Banner Image URL",bannerEnabled:"Banner Enabled",noBanner:"No banner set",supportContact:"Support Contact",supportEmail:"Support Email",supportWhatsapp:"Support WhatsApp",deliveryPricing:"Delivery Pricing",baseFee:"Base Fee (SAR)",perKmCity:"Price per KM (SAR)",minFee:"Minimum Fee (SAR)",maxFee:"Maximum Fee (SAR)",formulaPreview:"Formula Preview",distance:"Distance",estimatedFee:"Estimated Fee",pricingFormula:"Formula: Base Fee + (Distance \xD7 Price/KM)",invalidMinMax:"Minimum fee must be less than maximum fee",noNegative:"Values must be greater than zero",saveSettings:"Save Settings",settingsSaved:"Settings saved",failedSave:"Failed to save",language:"Language",arabic:"\u0627\u0644\u0639\u0631\u0628\u064A\u0629",english:"English",changePassword:"Change Password",currentPassword:"Current Password",newPassword:"New Password",confirmNewPassword:"Confirm Password",changePasswordBtn:"Change",passwordChanged:"Password changed",passwordMismatch:"Passwords do not match",passwordFailed:"Password change failed",adminNotifications:"Admin Notifications",notifyNewUser:"Notify on new customer signup",notifyNewProvider:"Notify on new provider signup",notifyNewDriver:"Notify on new driver signup",verification:"Verification",crVerifications:"CR Verification",freelanceRequests:"Freelance Certificate Requests",certNumber:"Certificate #",submittedAt:"Submitted At",reviewStatus:"Review Status",approve:"Approve",reject:"Reject",pendingReview:"Pending Review",verifiedStatus:"Verified",unverifiedStatus:"Unverified",notVerified:"Not Verified",viewDocument:"Verify Document",viewImage:"View Image",rejectReason:"Reject reason (internal)",verificationApproved:"Verification approved",verificationRejected:"Verification rejected",notifyCrVerification:"Notify on new CR verification",notifyFreelanceRequest:"Notify on new freelance request",noVerificationData:"No verification data",source:"Source",subWarning:"Subscription Warning",warningDays:"Warning days before expiry",sendReminder:"Send Reminder",reminderSent:"Reminder sent",addSubscription:"Add Subscription",amount:"Amount",startDate:"Start Date",endDate:"End Date",paymentMethod:"Payment Method",planName:"Plan Name",notes:"Notes",generateInvoice:"Generate Invoice",viewInvoice:"View Invoice",downloadPdf:"Download PDF",sendByEmail:"Send by Email",invoiceSaved:"Invoice saved",invoiceSent:"Invoice sent by email",invoiceEmailFailed:"Failed to send invoice",noInvoices:"No invoices found",invoiceNumber:"Invoice #",date:"Date",close:"Close",selectFile:"Select file",noName:"No name",na:"N/A",clickToExpand:"Click to expand",status:"Status",issued:"Issued",allInvoices:"All Invoices",notifications:"Notifications",broadcastTitle:"Notification Title",broadcastMessage:"Message",broadcastAudience:"Target Audience",audienceCustomers:"Customers",audienceProviders:"Providers",audienceDrivers:"Drivers",audienceAll:"All",broadcastSend:"Send Notification",broadcastHistory:"Notification History",broadcastConfirm:"Confirm Send",broadcastConfirmMsg:"Are you sure? This notification will be sent to all targeted users.",broadcastResult:"Send Result",broadcastMatched:"Users Matched",broadcastTokens:"Valid Tokens",broadcastSentCount:"Sent",broadcastFailed:"Failed",noBroadcastHistory:"No notification history",broadcastAudienceLabel:"Audience",deleteNotif:"Delete",resendNotif:"Resend",editResend:"Edit & Resend",editResendSend:"Send Edited Copy",confirmDelete:"Confirm Delete",confirmDeleteMsg:"Are you sure? Only the history record will be deleted. Sent notifications are not recalled.",confirmResend:"Confirm Resend",confirmResendMsg:"Are you sure? This notification will be resent to the targeted audience.",notifDeleted:"Record deleted",deleteFailed:"Delete failed",resendSuccess:"Resend successful",resendFailed:"Resend failed",providerSubSettings:"Provider Subscription Settings",driverSubSettings:"Driver Subscription Settings",subActive:"Subscription Active",subPrice:"Subscription Price (SAR)",subPeriod:"Subscription Period",periodWeekly:"Weekly",periodMonthly:"Monthly",periodQuarterly:"Quarterly",periodYearly:"Yearly",freeTrialEnabledLabel:"Free Trial Enabled",freeTrialTextArLabel:"Free Trial Text (Arabic)",freeTrialTextEnLabel:"Free Trial Text (English)"}};
var lang=localStorage.getItem("tbk_admin_lang")||"ar";
function t(k){return(T[lang]&&T[lang][k])||T.en[k]||k;}
function setLang(l){lang=l;localStorage.setItem("tbk_admin_lang",l);var d=l==="ar"?"rtl":"ltr";document.documentElement.dir=d;document.documentElement.lang=l;updateStaticLabels();renderPage();}
function updateStaticLabels(){
  document.getElementById("login-subtitle").textContent=t("adminDashboard");
  document.getElementById("login-pw-label").textContent=t("adminPassword");
  document.getElementById("login-password").placeholder=t("enterPassword");
  document.getElementById("login-btn").textContent=t("signIn");
  document.getElementById("sidebar-subtitle").textContent=t("adminPanel");
  document.getElementById("nav-dashboard").textContent=t("dashboard");
  document.getElementById("nav-users").textContent=t("users");
   var ncEl=document.getElementById("nav-complaints");if(ncEl)ncEl.textContent=ct("nav");
  var nvEl=document.getElementById("nav-verification");if(nvEl)nvEl.textContent=t("verification");
  document.getElementById("nav-invoices").textContent=t("invoices");
  document.getElementById("nav-settings").textContent=t("settings");
  document.getElementById("nav-logout").textContent=t("logout");
  var nnEl=document.getElementById("nav-notifications");if(nnEl)nnEl.textContent=t("notifications");
}

var TOKEN=sessionStorage.getItem("tbk_admin_token");
var currentPage="dashboard";
var allUsers=[];
var allOrders=[];
var allOffers=[];
var allInvoices=[];
var appSettings={};
 var complaintLabels={ar:{nav:"\u0628\u0644\u0627\u063A\u0627\u062A",title:"\u0628\u0644\u0627\u063A\u0627\u062A \u0627\u0644\u0634\u0643\u0627\u0648\u0649",all:"\u0627\u0644\u0643\u0644",pending:"\u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629",resolved:"\u062A\u0645 \u0627\u0644\u062D\u0644",closed:"\u0645\u063A\u0644\u0642\u0629",customerComplaint:"\u0634\u0643\u0648\u0649 \u0639\u0645\u064A\u0644",providerComplaint:"\u0634\u0643\u0648\u0649 \u0645\u0642\u062F\u0645 \u062E\u062F\u0645\u0629",deliveryNotConfirmed:"\u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u063A\u064A\u0631 \u0645\u0624\u0643\u062F",customerRejectedReceipt:"\u0631\u0641\u0636 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0625\u064A\u0635\u0627\u0644",customer:"\u0627\u0644\u0639\u0645\u064A\u0644",provider:"\u0645\u0642\u062F\u0645 \u0627\u0644\u062E\u062F\u0645\u0629",driver:"\u0627\u0644\u0633\u0627\u0626\u0642",order:"\u0627\u0644\u0637\u0644\u0628",orderNumber:"\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628",complaintType:"\u0646\u0648\u0639 \u0627\u0644\u0628\u0644\u0627\u063A",source:"\u0627\u0644\u0645\u0635\u062F\u0631",target:"\u0627\u0644\u0637\u0631\u0641 \u0627\u0644\u0645\u0639\u0646\u064A",note:"\u0646\u0635 \u0627\u0644\u0628\u0644\u0627\u063A",adminReply:"\u0631\u062F \u0627\u0644\u0625\u062F\u0627\u0631\u0629",created:"\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0646\u0634\u0627\u0621",updated:"\u0622\u062E\u0631 \u062A\u062D\u062F\u064A\u062B",status:"\u0627\u0644\u062D\u0627\u0644\u0629",details:"\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644",save:"\u062D\u0641\u0638 \u0627\u0644\u062A\u062D\u062F\u064A\u062B",saved:"\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0628\u0644\u0627\u063A",saveFailed:"\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0628\u0644\u0627\u063A",noComplaints:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0644\u0627\u063A\u0627\u062A",search:"\u0628\u062D\u062B \u0628\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628 \u0623\u0648 \u0627\u0644\u0646\u0635 \u0623\u0648 \u0627\u0644\u0627\u0633\u0645",loading:"\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...",unknown:"\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631",noUser:"\u062D\u0633\u0627\u0628 \u0645\u062D\u0630\u0648\u0641 \u0623\u0648 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631"},en:{nav:"Complaints",title:"Complaint Management",all:"All",pending:"Pending",resolved:"Resolved",closed:"Closed",customerComplaint:"Customer complaint",providerComplaint:"Provider complaint",deliveryNotConfirmed:"Delivery not confirmed",customerRejectedReceipt:"Receipt rejected",customer:"Customer",provider:"Provider",driver:"Driver",order:"Order",orderNumber:"Order number",complaintType:"Type",source:"Source",target:"Target",note:"Complaint",adminReply:"Admin reply",created:"Created",updated:"Updated",status:"Status",details:"Details",save:"Save update",saved:"Complaint updated",saveFailed:"Failed to update complaint",noComplaints:"No complaints found",search:"Search by order, text, or name",loading:"Loading...",unknown:"Unavailable",noUser:"Deleted or unavailable account"}};
 function ct(k){return(complaintLabels[lang]&&complaintLabels[lang][k])||complaintLabels.en[k]||k;}

async function api(path,opts){
  opts=opts||{};
  var h={"Content-Type":"application/json","Authorization":"Bearer "+TOKEN};
  if(opts.headers)for(var k in opts.headers)h[k]=opts.headers[k];
  opts.headers=h;
  var res=await fetch("/admin/api"+path,opts);
  if(res.status===401){sessionStorage.removeItem("tbk_admin_token");TOKEN=null;showLogin();return null;}
  return res.json();
}

function showLogin(){document.getElementById("login-view").style.display="flex";document.getElementById("main-view").style.display="none";}
function showMain(){document.getElementById("login-view").style.display="none";document.getElementById("main-view").style.display="block";if(isMobile()){forceSidebarClosed();}else{closeSidebar();}setTimeout(function(){navigate("dashboard");},0);}

function setLoginStatus(message,type){
  var el=document.getElementById("login-status");
  if(!el)return;
  el.textContent=message||"";
  el.className="login-status"+(type?" "+type:"");
}
async function doLogin(event){
  if(event&&event.preventDefault)event.preventDefault();
  var pwEl=document.getElementById("login-password");
  var btn=document.getElementById("login-btn");
  var errEl=document.getElementById("login-error");
  var pw=pwEl?pwEl.value:"";
  if(errEl){errEl.textContent="";errEl.style.display="none";}
  if(!pw){
    setLoginStatus(t("enterPassword"),"error");
    if(pwEl)pwEl.focus();
    return false;
  }
  if(btn){btn.disabled=true;btn.textContent="\u062C\u0627\u0631\u064A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644...";}
  setLoginStatus("\u062C\u0627\u0631\u064A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644...","loading");
  try{
    var res=await fetch("/admin/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
    var data=null;
    try{data=await res.json();}catch(e){data=null;}
    if(res.status===401){
      setLoginStatus("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629","error");
      return false;
    }
    if(!res.ok||!data||!data.token){
      setLoginStatus("\u062A\u0639\u0630\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644\u060C \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649","error");
      return false;
    }
    TOKEN=data.token;
    sessionStorage.setItem("tbk_admin_token",TOKEN);
    setLoginStatus("","success");
    showMain();
    return true;
  }catch(e){
    setLoginStatus("\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u0627\u062F\u0645","error");
    return false;
  }finally{
    if(btn){btn.disabled=false;btn.textContent=t("signIn");}
  }
}

function doLogout(){TOKEN=null;sessionStorage.removeItem("tbk_admin_token");showLogin();}

function isMobile(){return window.innerWidth<=768;}
function toggleSidebar(){var sb=document.getElementById("sidebar");var bd=document.getElementById("sidebar-backdrop");if(!sb||!bd)return;if(sb.classList.contains("open")){closeSidebar();}else{if(isMobile()){sb.style.visibility="";sb.style.pointerEvents="";}sb.classList.add("open");bd.classList.add("show");document.body.style.overflow="hidden";}}
function closeSidebar(){var sb=document.getElementById("sidebar");var bd=document.getElementById("sidebar-backdrop");if(sb){sb.classList.remove("open");if(isMobile()){sb.style.visibility="hidden";sb.style.pointerEvents="none";}}if(bd){bd.classList.remove("show");}document.body.style.overflow="";}
function forceSidebarClosed(){var sb=document.getElementById("sidebar");var bd=document.getElementById("sidebar-backdrop");if(sb){sb.classList.remove("open");sb.style.visibility="hidden";sb.style.pointerEvents="none";}if(bd){bd.classList.remove("show");}document.body.style.overflow="";}
function initSidebar(){var sb=document.getElementById("sidebar");if(!sb)return;sb.classList.remove("open");if(isMobile()){sb.style.visibility="hidden";sb.style.pointerEvents="none";}var bd=document.getElementById("sidebar-backdrop");if(bd)bd.classList.remove("show");document.body.style.overflow="";requestAnimationFrame(function(){requestAnimationFrame(function(){sb.classList.add("animated");});});}
function updateMobilePageName(){var el=document.getElementById("mobile-page-name");if(el)el.textContent=t(currentPage)||"";}

function navigate(page){
  currentPage=page;
  document.querySelectorAll(".nav-item[data-page]").forEach(function(el){el.classList.toggle("active",el.dataset.page===page);});
  if(isMobile()){forceSidebarClosed();}else{closeSidebar();}
  updateMobilePageName();
  renderPage();
}

function toast(msg,type){type=type||"success";var el=document.getElementById("toast");el.textContent=msg;el.className="toast show "+type;setTimeout(function(){el.className="toast";},3000);}
function closeModal(){document.getElementById("modal-overlay").classList.remove("show");}
function openModal(html){document.getElementById("modal-content").innerHTML=html;document.getElementById("modal-overlay").classList.add("show");}
function esc(s){if(!s)return"";var d=document.createElement("div");d.textContent=s;return d.innerHTML;}

function roleBadge(role){
  var m={customer:"blue",provider:"orange",driver:"purple"};
  var l={customer:t("customer"),provider:t("provider"),driver:t("driver")};
  return '<span class="badge badge-'+(m[role]||"gray")+'">'+( l[role]||role)+'</span>';
}
function statusBadge(status){
  var m={active:"green",trial:"yellow",suspended:"yellow",disabled:"red"};
  var l={active:t("active"),trial:t("trial"),suspended:t("suspend"),disabled:t("disabled")};
  return '<span class="badge badge-'+(m[status]||"gray")+'">'+( l[status]||status||t("na"))+'</span>';
}
function subBadge(status){
  var m={active:"green",trialing:"blue",expired:"red",canceled:"gray",past_due:"yellow"};
  var l={active:t("active"),trialing:t("trialing"),expired:t("expired"),canceled:t("canceledSub"),past_due:t("pastDue")};
  return '<span class="badge badge-'+(m[status]||"gray")+'">'+( l[status]||status||t("na"))+'</span>';
}

function getSubDaysRemaining(u){
  var endDate=u.subscriptionEndsAt||u.trialEndsAt;
  if(!endDate)return null;
  var diff=Math.ceil((new Date(endDate)-Date.now())/(1000*60*60*24));
  return diff;
}

function subStatusLabel(u){
  if(u.role==="customer")return "";
  var days=getSubDaysRemaining(u);
  if(days===null)return "";
  var warnDays=appSettings.subscriptionWarningDays!=null?appSettings.subscriptionWarningDays:7;
  if(days<=0)return '<span class="sub-expired">'+t("expired")+" ("+Math.abs(days)+" "+t("days")+")</span>";
  if(days<=warnDays)return '<span class="sub-warn">'+t("expiringIn")+" "+days+" "+t("days")+"</span>";
  return '<span class="sub-active">'+days+" "+t("daysRemaining")+"</span>";
}

function verifBadge(s){
  var m={verified:"green",pending_review:"yellow",unverified:"red",none:"gray"};
  var l={verified:t("verifiedStatus"),pending_review:t("pendingReview"),unverified:t("unverifiedStatus"),none:t("notVerified")};
  return '<span class="badge badge-'+(m[s]||"gray")+'">'+(l[s]||s||t("na"))+'</span>';
}
function flReviewBadge(s){
  var m={approved:"green",pending:"yellow",pending_review:"yellow",rejected:"red"};
  var l={approved:t("verifiedStatus"),pending:t("pendingReview"),pending_review:t("pendingReview"),rejected:t("unverifiedStatus")};
  return '<span class="badge badge-'+(m[s]||"gray")+'">'+(l[s]||s||t("na"))+'</span>';
}
function complaintStatusBadge(status){
  var m={pending:"yellow",resolved:"green",closed:"gray"};
  return '<span class="badge badge-'+(m[status]||"gray")+'">'+esc(complaintStatusLabel(status))+'</span>';
}
function complaintStatusLabel(status){return ct(status==="pending"?"pending":status==="resolved"?"resolved":status==="closed"?"closed":"unknown");}
function complaintTypeLabel(type){
  var m={customer_complaint:"customerComplaint",provider_complaint:"providerComplaint",delivery_not_confirmed:"deliveryNotConfirmed",customer_rejected_receipt:"customerRejectedReceipt"};
  return ct(m[type]||"unknown");
}
function complaintDate(value){
  if(!value)return "-";
  var d=new Date(value);
  return isNaN(d.getTime())?esc(String(value)):esc(d.toLocaleString(lang==="ar"?"ar-SA":"en-US"));
}
function complaintPerson(item,role){
  var p=item&&item[role]||{};
  return '<strong>'+esc(p.displayName||p.email||p.uid||ct("noUser"))+'</strong>'+(p.email&&p.displayName?'<div style="font-size:12px;color:var(--text2)">'+esc(p.email)+'</div>':"");
}
var complaintFilter={status:"all",search:""};
var allComplaints=[];
async function renderComplaints(c){
  var data=await api("/complaints");
  if(!data)return;
  allComplaints=data.complaints||[];
  var counts={all:allComplaints.length,pending:0,resolved:0,closed:0};
  allComplaints.forEach(function(x){if(counts[x.complaintStatus]!==undefined)counts[x.complaintStatus]++;});
  var cards=["all","pending","resolved","closed"].map(function(s){
    return '<button class="stat-card '+(complaintFilter.status===s?"selected":"")+'" data-status="'+s+'" onclick="setComplaintStatusFilter(this.dataset.status)" style="text-align:inherit;cursor:pointer"><div class="stat-label">'+ct(s)+'</div><div class="stat-value">'+counts[s]+'</div></button>';
  }).join("");
  c.innerHTML='<h1 class="page-title">'+ct("title")+'</h1>'+
    '<div class="stats-grid complaint-stats">'+cards+'</div>'+
    '<div class="settings-section">'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">'+
    '<input id="complaint-search" type="search" value="'+esc(complaintFilter.search)+'" placeholder="'+ct("search")+'" style="flex:1;min-width:220px;padding:9px;border:1px solid var(--border);border-radius:6px" oninput="filterComplaints(this.value)">'+
    '<select id="complaint-status-filter" onchange="setComplaintStatusFilter(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:6px">'+
    ["all","pending","resolved","closed"].map(function(s){return'<option value="'+s+'" '+(complaintFilter.status===s?"selected":"")+'>'+ct(s)+'</option>';}).join("")+
    '</select></div>'+
    '<div class="table-wrap"><table><thead><tr><th>'+ct("orderNumber")+'</th><th>'+ct("complaintType")+'</th><th>'+ct("source")+'</th><th>'+ct("target")+'</th><th>'+ct("note")+'</th><th>'+ct("status")+'</th><th>'+ct("created")+'</th><th>'+ct("details")+'</th></tr></thead><tbody id="complaints-body"></tbody></table></div></div>';
  paintComplaintRows();
}
function setComplaintStatusFilter(status){
  complaintFilter.status=status||"all";
  renderPage();
}
function filterComplaints(search){
  complaintFilter.search=search||"";
  paintComplaintRows();
}
function paintComplaintRows(){
  var body=document.getElementById("complaints-body");
  if(!body)return;
  var q=(complaintFilter.search||"").toLowerCase();
  var items=allComplaints.filter(function(x){
    if(complaintFilter.status!=="all"&&x.complaintStatus!==complaintFilter.status)return false;
    if(!q)return true;
    var text=[x.orderNumber,x.note,x.type,x.source,x.target,x.customer&&x.customer.displayName,x.provider&&x.provider.displayName,x.driver&&x.driver.displayName].join(" ").toLowerCase();
    return text.indexOf(q)>=0;
  });
  body.innerHTML=items.map(function(x){
    var id=esc(x.id||"");
    return '<tr><td><strong>'+esc(x.orderNumber||x.orderId||"-")+'</strong><div style="font-size:11px;color:var(--text2)">'+esc(x.orderId||"")+'</div></td>'+
      '<td>'+esc(complaintTypeLabel(x.type))+'</td>'+
      '<td>'+esc(complaintRoleLabel(x.source))+'</td>'+
      '<td>'+esc(complaintRoleLabel(x.target))+'</td>'+
      '<td style="max-width:260px;white-space:pre-wrap">'+esc(x.note||"-")+'</td>'+
      '<td>'+complaintStatusBadge(x.complaintStatus)+'</td>'+
      '<td style="font-size:12px;white-space:nowrap">'+complaintDate(x.createdAt)+'</td>'+
      '<td><button class="btn btn-secondary btn-sm" data-id="'+id+'" onclick="viewComplaint(this.dataset.id)">'+ct("details")+'</button></td></tr>';
  }).join("")||'<tr><td colspan="8" class="empty">'+ct("noComplaints")+'</td></tr>';
}
function complaintRoleLabel(role){
  var m={customer:"customer",provider:"provider",driver:"driver"};
  return ct(m[role]||"unknown");
}
async function viewComplaint(id){
  openModal('<div class="loading">'+ct("loading")+'</div>');
  var data=await api("/complaints/"+encodeURIComponent(id));
  if(!data||!data.complaint){closeModal();toast((data&&data.error)||ct("saveFailed"),"error");return;}
  var x=data.complaint;
  openModal('<h3 style="margin-bottom:16px">'+ct("title")+' <span style="font-size:13px;color:var(--text2)">#'+esc(x.orderNumber||x.orderId||x.id)+'</span></h3>'+
    '<div class="detail-grid">'+
    '<div><label>'+ct("orderNumber")+'</label><strong>'+esc(x.orderNumber||x.orderId||"-")+'</strong></div>'+
    '<div><label>'+ct("complaintType")+'</label><strong>'+esc(complaintTypeLabel(x.type))+'</strong></div>'+
    '<div><label>'+ct("source")+'</label><strong>'+esc(complaintRoleLabel(x.source))+'</strong></div>'+
    '<div><label>'+ct("target")+'</label><strong>'+esc(complaintRoleLabel(x.target))+'</strong></div>'+
    '<div><label>'+ct("customer")+'</label>'+complaintPerson(x,"customer")+'</div>'+
    '<div><label>'+ct("provider")+'</label>'+complaintPerson(x,"provider")+'</div>'+
    '<div><label>'+ct("driver")+'</label>'+complaintPerson(x,"driver")+'</div>'+
    '<div><label>'+ct("created")+'</label><strong>'+complaintDate(x.createdAt)+'</strong></div>'+
    '</div>'+
    '<div class="form-group"><label>'+ct("note")+'</label><div style="padding:10px;background:var(--surface2);border-radius:6px;white-space:pre-wrap">'+esc(x.note||"-")+'</div></div>'+
    '<div class="form-group"><label for="complaint-status">'+ct("status")+'</label><select id="complaint-status" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:6px">'+["pending","resolved","closed"].map(function(s){return'<option value="'+s+'" '+(x.complaintStatus===s?"selected":"")+'>'+ct(s)+'</option>';}).join("")+'</select></div>'+
    '<div class="form-group"><label for="complaint-admin-note">'+ct("adminReply")+'</label><textarea id="complaint-admin-note" rows="4" maxlength="4000" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:6px;resize:vertical">'+esc(x.adminNote||"")+'</textarea></div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:12px">'+ct("updated")+': '+complaintDate(x.updatedAt)+'</div>'+
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button> <button class="btn btn-orange" data-id="'+esc(x.id)+'" onclick="saveComplaint(this.dataset.id)">'+ct("save")+'</button></div>');
}
async function saveComplaint(id){
  var statusEl=document.getElementById("complaint-status");
  var noteEl=document.getElementById("complaint-admin-note");
  var data=await api("/complaints/"+encodeURIComponent(id)+"/update",{method:"POST",body:JSON.stringify({complaintStatus:statusEl?statusEl.value:"pending",adminNote:noteEl?noteEl.value:""})});
  if(data&&data.success){closeModal();toast(ct("saved"));renderPage();}else{toast((data&&data.error)||ct("saveFailed"),"error");}
}
async function renderVerification(c){
  var data=await api("/verification");
  if(!data)return;
  var items=data.items||[];
  var crRows=items.map(function(it){
    var v=it.verification||{};
    var d=v.submittedAt||it.verifiedAt;
    var ds=d?new Date(d).toLocaleDateString():"-";
    return '<tr><td>'+esc(it.displayName||t("noName"))+'<div style="font-size:12px;color:var(--text2)">'+esc(it.email||"")+'</div></td>'+
      '<td>'+esc(v.crNumber||"-")+'</td>'+
      '<td>'+verifBadge(it.verificationStatus)+'</td>'+
      '<td>'+esc(it.verificationSource||"-")+'</td>'+
      '<td style="font-size:12px;color:var(--text2)">'+ds+'</td></tr>';
  }).join("");
  var fl=items.filter(function(it){return it.verification&&it.verification.freelanceCertificate;});
  var flRows=fl.map(function(it){
    var fc=it.verification.freelanceCertificate||{};
    var sub=fc.submittedAt?new Date(fc.submittedAt).toLocaleDateString():"-";
    var img=fc.fileUrl||"";
    var rs=fc.reviewStatus||"pending";
    var imgBtn=img?'<a class="btn btn-sm btn-secondary" href="'+esc(img)+'" target="_blank" rel="noopener">'+t("viewImage")+'</a> ':"";
    var act=(rs==="approved"||rs==="rejected")?"":'<button class="btn btn-sm btn-success" onclick="approveFreelance(\\''+esc(it.uid)+'\\')">'+t("approve")+'</button> <button class="btn btn-sm btn-warning" onclick="rejectFreelance(\\''+esc(it.uid)+'\\')">'+t("reject")+'</button>';
    return '<tr><td>'+esc(it.displayName||t("noName"))+'<div style="font-size:12px;color:var(--text2)">'+esc(it.email||"")+'</div></td>'+
      '<td>'+esc(fc.certificateNumber||"-")+'</td>'+
      '<td>'+flReviewBadge(rs)+'</td>'+
      '<td style="font-size:12px;color:var(--text2)">'+sub+'</td>'+
      '<td style="white-space:nowrap">'+imgBtn+act+'</td></tr>';
  }).join("");
  c.innerHTML='<h1 class="page-title">'+t("verification")+'</h1>'+
    '<div style="margin-bottom:16px"><a class="btn btn-orange" href="https://freelance.sa/certificate-validation" target="_blank" rel="noopener">'+t("viewDocument")+'</a></div>'+
    '<div class="settings-section"><h3>'+t("crVerifications")+'</h3><div class="table-wrap"><table><thead><tr><th>'+t("user")+'</th><th>'+t("certNumber")+'</th><th>'+t("status")+'</th><th>'+t("source")+'</th><th>'+t("date")+'</th></tr></thead><tbody>'+(crRows||'<tr><td colspan="5" class="empty">'+t("noVerificationData")+'</td></tr>')+'</tbody></table></div></div>'+
    '<div class="settings-section"><h3>'+t("freelanceRequests")+'</h3><div class="table-wrap"><table><thead><tr><th>'+t("user")+'</th><th>'+t("certNumber")+'</th><th>'+t("reviewStatus")+'</th><th>'+t("submittedAt")+'</th><th>'+t("actions")+'</th></tr></thead><tbody>'+(flRows||'<tr><td colspan="5" class="empty">'+t("noData")+'</td></tr>')+'</tbody></table></div></div>';
}
async function approveFreelance(uid){
  var data=await api("/verification/freelance/"+uid+"/approve",{method:"POST",body:JSON.stringify({})});
  if(data&&data.success){toast(t("verificationApproved"));renderPage();}else{toast((data&&data.error)||t("failedUpdate"),"error");}
}
function rejectFreelance(uid){
  openModal('<h3>'+t("reject")+'</h3><div class="form-group"><label>'+t("rejectReason")+'</label><textarea id="rej-note" rows="3" style="width:100%"></textarea></div><div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button> <button class="btn btn-warning" onclick="confirmRejectFreelance(\\''+esc(uid)+'\\')">'+t("reject")+'</button></div>');
}
async function confirmRejectFreelance(uid){
  var el=document.getElementById("rej-note");
  var note=el?el.value:"";
  var data=await api("/verification/freelance/"+uid+"/reject",{method:"POST",body:JSON.stringify({note:note})});
  if(data&&data.success){toast(t("verificationRejected"));closeModal();renderPage();}else{toast((data&&data.error)||t("failedUpdate"),"error");}
}
async function renderPage(){
  if(isMobile()){forceSidebarClosed();}else{closeSidebar();}
  var c=document.getElementById("page-content");
  c.innerHTML='<div class="loading">'+t("loading")+'</div>';
  try{
    if(currentPage==="dashboard")await renderDashboard(c);
    else if(currentPage==="users")await renderUsers(c);
     else if(currentPage==="complaints")await renderComplaints(c);
    else if(currentPage==="verification")await renderVerification(c);
    else if(currentPage==="invoices")await renderInvoices(c);
    else if(currentPage==="settings")await renderSettings(c);
    else if(currentPage==="notifications")await renderNotifications(c);
  }catch(e){c.innerHTML='<div class="empty">Error: '+esc(e.message)+'</div>';}
}

async function renderDashboard(c){
  var data=await api("/stats");
  if(!data)return;
  var s=data.stats;
  allUsers=data.users||[];
  allOrders=data.orders||[];
  allOffers=data.offers||[];
  c.innerHTML='<h1 class="page-title">'+t("dashboard")+'</h1>'+
    '<div class="stats-grid">'+
    statCard("totalUsers",s.totalUsers,"blue","all")+
    statCard("customers",s.customers,"green","customer")+
    statCard("providers",s.providers,"orange","provider")+
    statCard("drivers",s.drivers,"purple","driver")+
    statCard("providersInTrial",s.providersInTrial,"amber")+
    statCard("driversInTrial",s.driversInTrial,"amber")+
    statCard("suspended",s.suspendedAccounts,"red")+
    statCard("activeSubs",s.activeSubscriptions,"teal")+
    '</div><div id="drill-down"></div>';
}

function statCard(labelKey,value,color,drillRole){
  var onclick=drillRole?'onclick="drillDown(\\''+drillRole+'\\')"':"";
  return '<div class="stat-card '+color+'" '+onclick+'><div class="label">'+t(labelKey)+'</div><div class="value">'+(value||0)+'</div></div>';
}

function drillDown(role){
  var dd=document.getElementById("drill-down");
  if(!dd)return;
  var users=role==="all"?allUsers:allUsers.filter(function(u){return u.role===role;});
  var roleLabel=role==="all"?t("totalUsers"):t(role==="customer"?"customers":role==="provider"?"providers":"drivers");
  var isProvider=role==="provider";
  var isDriver=role==="driver";
  var html='<div class="drill-section"><span class="drill-close" onclick="this.parentElement.remove()">&times;</span><h3>'+roleLabel+" ("+users.length+")</h3>";
  html+='<div class="table-wrap"><table><thead><tr>';
  html+="<th>"+t("name")+"</th><th>"+t("email")+"</th><th>"+t("phone")+"</th><th>"+t("totalOrders")+"</th><th>"+t("delivered")+"</th><th>"+t("canceled")+"</th>";
  if(isProvider||isDriver)html+="<th>"+t("rating")+"</th>";
  if(isProvider)html+="<th>"+t("images")+"</th>";
  if(isDriver)html+="<th>"+t("images")+"</th>";
  html+="</tr></thead><tbody>";
  users.forEach(function(u){
    var uid=u._id;
    var field=role==="customer"?"customerUid":role==="provider"?"providerUid":"driverUid";
    var uOrders=allOrders.filter(function(o){return o[field]===uid;});
    var deliveredCount=uOrders.filter(function(o){return o.status==="delivered";}).length;
    var canceledCount=uOrders.filter(function(o){return o.status==="cancelled"||o.status==="rejected";}).length;
    html+="<tr><td>"+esc(u.displayName||t("noName"))+"</td><td>"+esc(u.email||"")+"</td><td>"+esc(u.phone||"")+"</td>";
    html+="<td>"+uOrders.length+"</td><td>"+deliveredCount+"</td><td>"+canceledCount+"</td>";
    if(isProvider||isDriver){
      var avg=u.ratingAverage||u.ratingAvg||0;
      var cnt=u.ratingCount||0;
      html+="<td>"+(typeof avg==="number"?avg.toFixed(1):"0")+" ("+cnt+")</td>";
    }
    if(isProvider){
      var provOffers=allOffers.filter(function(o){return o.providerId===uid||o.providerUid===uid;});
      var imgs=provOffers.filter(function(o){return o.imageUrl;}).map(function(o){return o.imageUrl;});
      if(u.photoUrl)imgs.unshift(u.photoUrl);
      html+="<td>"+imgs.slice(0,3).map(function(url){return '<img class="img-thumb" src="'+esc(url)+'" onclick="window.open(this.src,\\'_blank\\')">'}).join(" ")+"</td>";
    }
    if(isDriver){
      var dimgs=[];
      if(u.vehicleImageUrl)dimgs.push(u.vehicleImageUrl);
      if(u.photoUrl)dimgs.push(u.photoUrl);
      html+="<td>"+dimgs.slice(0,3).map(function(url){return '<img class="img-thumb" src="'+esc(url)+'" onclick="window.open(this.src,\\'_blank\\')">'}).join(" ")+"</td>";
    }
    html+="</tr>";
  });
  html+="</tbody></table></div></div>";
  dd.innerHTML=html;
}

async function renderUsers(c){
  var data=await api("/users");
  if(!data)return;
  allUsers=data.users||[];
  c.innerHTML='<h1 class="page-title">'+t("users")+" ("+allUsers.length+")</h1>"+
    '<div class="filters">'+
    '<select id="f-role" onchange="filterUsers()"><option value="">'+t("allRoles")+'</option><option value="customer">'+t("customer")+'</option><option value="provider">'+t("provider")+'</option><option value="driver">'+t("driver")+'</option></select>'+
    '<select id="f-status" onchange="filterUsers()"><option value="">'+t("allStatus")+'</option><option value="active">'+t("active")+'</option><option value="trial">'+t("trial")+'</option><option value="suspended">'+t("suspend")+'</option><option value="disabled">'+t("disabled")+'</option></select>'+
    '<select id="f-sub" onchange="filterUsers()"><option value="">'+t("allSubs")+'</option><option value="trialing">'+t("trialing")+'</option><option value="active">'+t("active")+'</option><option value="expired">'+t("expired")+'</option><option value="canceled">'+t("canceledSub")+'</option><option value="past_due">'+t("pastDue")+'</option></select>'+
    '<input type="text" id="f-search" placeholder="'+t("searchPlaceholder")+'" oninput="filterUsers()">'+
    '</div>'+
    '<div class="table-wrap"><table><thead><tr><th>'+t("user")+'</th><th>'+t("role")+'</th><th>'+t("account")+'</th><th>'+t("subscription")+'</th><th>'+t("subStatus")+'</th><th>'+t("created")+'</th><th>'+t("actions")+'</th></tr></thead><tbody id="users-tbody"></tbody></table></div>';
  filterUsers();
}

function filterUsers(){
  var role=document.getElementById("f-role")?document.getElementById("f-role").value:"";
  var status=document.getElementById("f-status")?document.getElementById("f-status").value:"";
  var sub=document.getElementById("f-sub")?document.getElementById("f-sub").value:"";
  var search=(document.getElementById("f-search")?document.getElementById("f-search").value:"").toLowerCase();
  var filtered=allUsers;
  if(role)filtered=filtered.filter(function(u){return u.role===role;});
  if(status)filtered=filtered.filter(function(u){return u.accountStatus===status;});
  if(sub)filtered=filtered.filter(function(u){return u.subscriptionStatus===sub;});
  if(search)filtered=filtered.filter(function(u){
    return(u.displayName||"").toLowerCase().indexOf(search)>=0||(u.email||"").toLowerCase().indexOf(search)>=0||(u.phone||"").indexOf(search)>=0;
  });
  var tbody=document.getElementById("users-tbody");
  if(!tbody)return;
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="7" class="empty">'+t("noUsersFound")+'</td></tr>';return;}
  tbody.innerHTML=filtered.map(function(u){
    var created=u.createdAt?new Date(u.createdAt).toLocaleDateString():"N/A";
    return "<tr>"+
      "<td><div class=\\"user-info-row\\"><span class=\\"name\\">"+esc(u.displayName||t("noName"))+"</span></div><div class=\\"user-info-row\\"><span class=\\"email\\">"+esc(u.email||"")+"</span></div></td>"+
      "<td>"+roleBadge(u.role)+"</td>"+
      "<td>"+statusBadge(u.accountStatus)+"</td>"+
      "<td>"+subBadge(u.subscriptionStatus)+"</td>"+
      "<td>"+subStatusLabel(u)+"</td>"+
      "<td style=\\"font-size:12px;color:var(--text2)\\">"+created+"</td>"+
      "<td><button class=\\"btn btn-sm btn-primary\\" onclick=\\"editUser('"+u._id+"')\\">"+t("edit")+"</button></td>"+
    "</tr>";
  }).join("");
}

function editUser(uid){
  var u=allUsers.find(function(x){return x._id===uid;});
  if(!u)return;
  var trialDate=u.trialEndsAt?(u.trialEndsAt.split("T")[0]):"";
  var subDate=u.subscriptionEndsAt?(u.subscriptionEndsAt.split("T")[0]):"";
  var daysLeft=getSubDaysRemaining(u);
  var daysInfo=daysLeft!==null?("<div style=\\"margin-bottom:12px;padding:8px;border-radius:6px;font-size:13px;"+(daysLeft<=0?"background:#fee2e2;color:#991b1b":daysLeft<=7?"background:#fef3c7;color:#92400e":"background:#d1fae5;color:#065f46")+"\\">"+
    (daysLeft<=0?t("expired")+" ("+Math.abs(daysLeft)+" "+t("days")+")":daysLeft+" "+t("daysRemaining"))+
    "</div>"):"";
  var sel=function(id,val,opts){
    var h='<select id="'+id+'"><option value="">'+t("notSet")+"</option>";
    opts.forEach(function(o){h+='<option value="'+o.v+'"'+(val===o.v?" selected":"")+">"+o.l+"</option>";});
    return h+"</select>";
  };
  openModal(
    '<h3>'+t("editUser")+": "+esc(u.displayName||u.email||uid)+'</h3>'+
    '<div style="margin-bottom:12px;font-size:13px;color:var(--text2)">UID: '+uid+"<br>"+t("role")+": "+(u.role||"N/A")+" | "+t("email")+": "+esc(u.email||"")+"</div>"+
    daysInfo+
    '<div class="form-group"><label>'+t("accountStatus")+"</label>"+sel("eu-accountStatus",u.accountStatus,[{v:"active",l:t("active")},{v:"trial",l:t("trial")},{v:"suspended",l:t("suspend")},{v:"disabled",l:t("disabled")}])+"</div>"+
    '<div class="form-group"><label>'+t("subscriptionStatus")+"</label>"+sel("eu-subscriptionStatus",u.subscriptionStatus,[{v:"trialing",l:t("trialing")},{v:"active",l:t("active")},{v:"expired",l:t("expired")},{v:"canceled",l:t("canceledSub")},{v:"past_due",l:t("pastDue")}])+"</div>"+
    '<div class="form-group"><label>'+t("subscriptionPlan")+'</label><input id="eu-subscriptionPlan" value="'+esc(u.subscriptionPlan||"")+'"></div>'+
    '<div class="form-group"><label>'+t("trialEndsAt")+'</label><input type="date" id="eu-trialEndsAt" value="'+trialDate+'"></div>'+
    '<div class="form-group"><label>'+t("subscriptionEndsAt")+'</label><input type="date" id="eu-subscriptionEndsAt" value="'+subDate+'"></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="eu-activatedByAdmin"'+(u.activatedByAdmin?" checked":"")+'> '+t("activatedByAdmin")+'</label></div>'+
    '<div class="form-group"><label>'+t("disabledReason")+'</label><textarea id="eu-disabledReason" rows="2">'+esc(u.disabledReason||"")+'</textarea></div>'+
    '<hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">'+
    '<h3 style="font-size:15px;margin-bottom:12px">'+t("addSubscription")+'</h3>'+
    '<div class="grid-2">'+
    '<div class="form-group"><label>'+t("amount")+' (SAR)</label><input type="number" id="eu-subAmount" value="300"></div>'+
    '<div class="form-group"><label>'+t("planName")+'</label><input id="eu-subPlan" value="'+esc(u.subscriptionPlan||"basic")+'"></div>'+
    '<div class="form-group"><label>'+t("startDate")+'</label><input type="date" id="eu-subStart" value="'+new Date().toISOString().split("T")[0]+'"></div>'+
    '<div class="form-group"><label>'+t("endDate")+'</label><input type="date" id="eu-subEnd" value=""></div>'+
    '<div class="form-group"><label>'+t("paymentMethod")+'</label><select id="eu-subPayment"><option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="stc_pay">STC Pay</option></select></div>'+
    '<div class="form-group"><label>'+t("notes")+'</label><input id="eu-subNotes" value=""></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'+
    '<button class="btn btn-sm btn-orange" onclick="generateInvoice(\\''+uid+'\\')">'+t("generateInvoice")+'</button>'+
    (u.role!=="customer"?'<button class="btn btn-sm btn-warning" onclick="sendSubReminder(\\''+uid+'\\')">'+t("sendReminder")+'</button>':"")+
    '</div>'+
    '<div class="modal-actions">'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button>'+
    '<button class="btn btn-success" onclick="quickAction(\\''+uid+'\\',\\'activate\\')">'+t("activate")+'</button>'+
    '<button class="btn btn-warning" onclick="quickAction(\\''+uid+'\\',\\'suspend\\')">'+t("suspend")+'</button>'+
    '<button class="btn btn-primary" onclick="saveUser(\\''+uid+'\\')">'+t("save")+'</button>'+
    '</div>'
  );
}

async function quickAction(uid,action){
  var fields={};
  if(action==="activate")fields={accountStatus:"active",subscriptionStatus:"active",activatedByAdmin:true,disabledReason:""};
  else if(action==="suspend")fields={accountStatus:"suspended"};
  var data=await api("/users/"+uid+"/update",{method:"POST",body:JSON.stringify(fields)});
  if(data&&data.success){toast(t("userUpdated"));closeModal();renderPage();}else{toast(data&&data.error||t("failedUpdate"),"error");}
}

async function saveUser(uid){
  var fields={};
  var accountStatus=document.getElementById("eu-accountStatus").value;
  var subscriptionStatus=document.getElementById("eu-subscriptionStatus").value;
  var subscriptionPlan=document.getElementById("eu-subscriptionPlan").value;
  var trialEndsAt=document.getElementById("eu-trialEndsAt").value;
  var subscriptionEndsAt=document.getElementById("eu-subscriptionEndsAt").value;
  var activatedByAdmin=document.getElementById("eu-activatedByAdmin").checked;
  var disabledReason=document.getElementById("eu-disabledReason").value;
  if(accountStatus)fields.accountStatus=accountStatus;
  if(subscriptionStatus)fields.subscriptionStatus=subscriptionStatus;
  if(subscriptionPlan)fields.subscriptionPlan=subscriptionPlan;
  if(trialEndsAt)fields.trialEndsAt=new Date(trialEndsAt).toISOString();
  if(subscriptionEndsAt)fields.subscriptionEndsAt=new Date(subscriptionEndsAt).toISOString();
  fields.activatedByAdmin=activatedByAdmin;
  fields.disabledReason=disabledReason||"";
  var subAmount=document.getElementById("eu-subAmount").value;
  var subStart=document.getElementById("eu-subStart").value;
  var subEnd=document.getElementById("eu-subEnd").value;
  var subPayment=document.getElementById("eu-subPayment").value;
  var subPlan=document.getElementById("eu-subPlan").value;
  var subNotes=document.getElementById("eu-subNotes").value;
  if(subEnd&&subStart){
    fields.subscriptionEndsAt=new Date(subEnd).toISOString();
    if(subPlan)fields.subscriptionPlan=subPlan;
    fields.subscriptionMeta={amount:parseFloat(subAmount)||0,startDate:subStart,endDate:subEnd,paymentMethod:subPayment,notes:subNotes,updatedAt:new Date().toISOString()};
  }
  if(Object.keys(fields).length===0){toast(t("noChanges"),"error");return;}
  var data=await api("/users/"+uid+"/update",{method:"POST",body:JSON.stringify(fields)});
  if(data&&data.success){toast(t("userUpdated"));closeModal();renderPage();}else{toast(data&&data.error||t("failedUpdate"),"error");}
}

async function generateInvoice(uid){
  var u=allUsers.find(function(x){return x._id===uid;});
  if(!u)return;
  var amount=document.getElementById("eu-subAmount")?document.getElementById("eu-subAmount").value:"300";
  var subStart=document.getElementById("eu-subStart")?document.getElementById("eu-subStart").value:"";
  var subEnd=document.getElementById("eu-subEnd")?document.getElementById("eu-subEnd").value:"";
  var subPlan=document.getElementById("eu-subPlan")?document.getElementById("eu-subPlan").value:"basic";
  var subPayment=document.getElementById("eu-subPayment")?document.getElementById("eu-subPayment").value:"";
  var subNotes=document.getElementById("eu-subNotes")?document.getElementById("eu-subNotes").value:"";
  var invoice={userName:u.displayName||"",userEmail:u.email||"",userPhone:u.phone||"",subscriptionPlan:subPlan,amount:parseFloat(amount)||0,currency:"SAR",startDate:subStart,endDate:subEnd,paymentMethod:subPayment,notes:subNotes,invoiceNumber:"INV-"+new Date().getFullYear()+"-"+Date.now().toString().slice(-6),createdAt:new Date().toISOString(),userId:uid};
  try{
    var data=await api("/invoices",{method:"POST",body:JSON.stringify(invoice)});
    if(data&&data.success){
      toast(t("invoiceSaved"));
      showInvoiceActions(data.invoiceId,invoice);
    }else{toast(data&&data.error||"Failed","error");}
  }catch(e){toast(e.message,"error");}
}

function showInvoiceActions(invoiceId,invoice){
  openModal(
    '<h3>'+t("invoiceSaved")+'</h3>'+
    '<div style="margin-bottom:16px"><p style="font-size:14px;color:var(--text2);margin-bottom:4px">'+t("invoiceNumber")+': <strong>'+esc(invoice.invoiceNumber)+'</strong></p>'+
    '<p style="font-size:14px;color:var(--text2)">'+t("name")+': <strong>'+esc(invoice.userName)+'</strong></p>'+
    '<p style="font-size:14px;color:var(--text2)">'+t("amount")+': <strong>'+invoice.amount+' '+invoice.currency+'</strong></p></div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
    '<button class="btn btn-primary" onclick="viewInvoiceHTML(\\''+invoiceId+'\\')">'+t("viewInvoice")+'</button>'+
    '<button class="btn btn-orange" onclick="downloadInvoicePdf(\\''+invoiceId+'\\')">'+t("downloadPdf")+'</button>'+
    (invoice.userEmail?'<button class="btn btn-success" onclick="emailInvoice(\\''+invoiceId+'\\')">'+t("sendByEmail")+'</button>':"")+
    '</div>'+
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">'+t("close")+'</button></div>'
  );
}

async function viewInvoiceHTML(invoiceId){
  try{
    var data=await api("/invoices/"+invoiceId+"/token");
    if(data&&data.token){
      window.open("/admin/invoice/"+invoiceId+"?token="+encodeURIComponent(data.token)+"&lang="+lang,"_blank");
    }else{toast("Failed to get access token","error");}
  }catch(e){toast(e.message,"error");}
}

async function downloadInvoicePdf(invoiceId){
  try{
    var data=await api("/invoices/"+invoiceId+"/token");
    if(data&&data.token){
      var url="/admin/invoice/"+invoiceId+"/pdf?token="+encodeURIComponent(data.token)+"&lang="+lang;
      var a=document.createElement("a");a.href=url;a.download="invoice-"+invoiceId+".pdf";document.body.appendChild(a);a.click();document.body.removeChild(a);
    }else{toast("Failed to get access token","error");}
  }catch(e){toast(e.message,"error");}
}

async function emailInvoice(invoiceId){
  try{
    var data=await api("/invoices/"+invoiceId+"/email",{method:"POST",body:JSON.stringify({lang:lang})});
    if(data&&data.success)toast(t("invoiceSent"));
    else toast(data&&data.error||t("invoiceEmailFailed"),"error");
  }catch(e){toast(e.message,"error");}
}

async function sendSubReminder(uid){
  try{
    var data=await api("/send-reminder",{method:"POST",body:JSON.stringify({uid:uid})});
    if(data&&data.success)toast(t("reminderSent"));
    else toast(data&&data.error||"Failed","error");
  }catch(e){toast(e.message,"error");}
}

async function renderInvoices(c){
  var data=await api("/invoices");
  if(!data)return;
  allInvoices=data.invoices||[];
  allInvoices.sort(function(a,b){return(b.createdAt||"").localeCompare(a.createdAt||"");});
  c.innerHTML='<h1 class="page-title">'+t("allInvoices")+" ("+allInvoices.length+")</h1>";
  if(!allInvoices.length){c.innerHTML+='<div class="empty">'+t("noInvoices")+'</div>';return;}
  c.innerHTML+='<div class="table-wrap"><table><thead><tr><th>'+t("invoiceNumber")+'</th><th>'+t("name")+'</th><th>'+t("amount")+'</th><th>'+t("date")+'</th><th>'+t("status")+'</th><th>'+t("actions")+'</th></tr></thead><tbody>'+
  allInvoices.map(function(inv){
    var dt=inv.createdAt?new Date(inv.createdAt).toLocaleDateString():"N/A";
    return "<tr>"+
      "<td><strong>"+esc(inv.invoiceNumber||inv._id)+"</strong></td>"+
      "<td>"+esc(inv.userName||"")+"</td>"+
      "<td>"+(inv.amount||0)+" "+(inv.currency||"SAR")+"</td>"+
      "<td style=\\"font-size:12px;color:var(--text2)\\">"+dt+"</td>"+
      "<td><span class=\\"badge badge-green\\">"+t("issued")+"</span></td>"+
      "<td style=\\"white-space:nowrap\\">"+
        "<button class=\\"btn btn-sm btn-primary\\" style=\\"margin:2px\\" onclick=\\"viewInvoiceHTML('"+inv._id+"')\\">"+t("viewInvoice")+"</button> "+
        "<button class=\\"btn btn-sm btn-orange\\" style=\\"margin:2px\\" onclick=\\"downloadInvoicePdf('"+inv._id+"')\\">PDF</button> "+
        (inv.userEmail?"<button class=\\"btn btn-sm btn-success\\" style=\\"margin:2px\\" onclick=\\"emailInvoice('"+inv._id+"')\\">\u2709</button>":"")+
      "</td></tr>";
  }).join("")+
  "</tbody></table></div>";
}

async function renderSettings(c){
  var data=await api("/settings");
  if(!data)return;
  appSettings=data.settings||{};
  var bannerUrl=appSettings.bannerImageUrl||"";
  var bannerEnabled=appSettings.bannerEnabled!==false;
  c.innerHTML='<h1 class="page-title">'+t("appSettings")+'</h1>'+
    '<div class="settings-section"><h3>'+t("language")+'</h3>'+
    '<div class="lang-switch"><button class="'+(lang==="ar"?"active":"")+'" onclick="setLang(\\'ar\\')">'+t("arabic")+'</button><button class="'+(lang==="en"?"active":"")+'" onclick="setLang(\\'en\\')">'+t("english")+'</button></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("homeBanner")+'</h3>'+
    (bannerUrl?'<img class="banner-preview" src="'+esc(bannerUrl)+'" alt="Banner">':
    '<div class="banner-preview" style="display:flex;align-items:center;justify-content:center;color:var(--text3)">'+t("noBanner")+'</div>')+
    '<div class="upload-row"><input type="file" id="banner-file" accept="image/*" class="file-input"><button class="btn btn-sm btn-primary" id="upload-btn" onclick="uploadBanner()">'+t("upload")+'</button></div>'+
    '<div class="form-group"><label>'+t("bannerUrl")+'</label><input id="s-bannerImageUrl" value="'+esc(bannerUrl)+'" placeholder="https://..."></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-bannerEnabled"'+(bannerEnabled?" checked":"")+'> '+t("bannerEnabled")+'</label></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("supportContact")+'</h3>'+
    '<div class="form-group"><label>'+t("supportEmail")+'</label><input id="s-supportEmail" value="'+esc(appSettings.supportEmail||"")+'"></div>'+
    '<div class="form-group"><label>'+t("supportWhatsapp")+'</label><input id="s-supportWhatsapp" value="'+esc(appSettings.supportWhatsapp||"")+'"></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("deliveryPricing")+'</h3>'+
    '<p style="font-size:13px;color:var(--text2);margin-bottom:16px">'+t("pricingFormula")+'</p>'+
    '<div class="grid-2">'+
    '<div class="form-group"><label>'+t("baseFee")+'</label><input type="number" min="0" step="0.5" id="s-baseFee" value="'+(appSettings.deliveryPricing&&appSettings.deliveryPricing.baseFee!=null?appSettings.deliveryPricing.baseFee:5)+'" oninput="updatePricingPreview()"></div>'+
    '<div class="form-group"><label>'+t("perKmCity")+'</label><input type="number" min="0" step="0.5" id="s-perKmCity" value="'+(appSettings.deliveryPricing&&appSettings.deliveryPricing.perKmInsideCity!=null?appSettings.deliveryPricing.perKmInsideCity:2)+'" oninput="updatePricingPreview()"></div>'+
    '<div class="form-group"><label>'+t("minFee")+'</label><input type="number" min="0" step="0.5" id="s-minFee" value="'+(appSettings.deliveryPricing&&appSettings.deliveryPricing.minFee!=null?appSettings.deliveryPricing.minFee:5)+'" oninput="updatePricingPreview()"></div>'+
    '<div class="form-group"><label>'+t("maxFee")+'</label><input type="number" min="0" step="0.5" id="s-maxFee" value="'+(appSettings.deliveryPricing&&appSettings.deliveryPricing.maxFee!=null?appSettings.deliveryPricing.maxFee:50)+'" oninput="updatePricingPreview()"></div>'+
    '</div>'+
    '<div id="pricing-validation" style="margin-top:8px"></div>'+
    '<div id="pricing-preview" style="margin-top:12px;padding:16px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px"></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("subWarning")+'</h3>'+
    '<div class="form-group"><label>'+t("warningDays")+'</label><input type="number" id="s-warningDays" value="'+(appSettings.subscriptionWarningDays!=null?appSettings.subscriptionWarningDays:7)+'"></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("adminNotifications")+'</h3>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-notifyNewUser"'+(appSettings.notifyOnNewUser?" checked":"")+'> '+t("notifyNewUser")+'</label></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-notifyNewProvider"'+(appSettings.notifyOnNewProvider?" checked":"")+'> '+t("notifyNewProvider")+'</label></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-notifyNewDriver"'+(appSettings.notifyOnNewDriver?" checked":"")+'> '+t("notifyNewDriver")+'</label></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-notifyCrVerification"'+(appSettings.notifyOnCrVerification?" checked":"")+'> '+t("notifyCrVerification")+'</label></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-notifyFreelanceRequest"'+(appSettings.notifyOnFreelanceRequest?" checked":"")+'> '+t("notifyFreelanceRequest")+'</label></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("providerSubSettings")+'</h3>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-ps-active"'+(appSettings.providerSubscription&&appSettings.providerSubscription.active?" checked":"")+'> '+t("subActive")+'</label></div>'+
    '<div class="form-group"><label>'+t("subPrice")+'</label><input type="number" min="0" step="0.5" id="s-ps-price" value="'+(appSettings.providerSubscription&&appSettings.providerSubscription.price!=null?appSettings.providerSubscription.price:15)+'"></div>'+
    '<div class="form-group"><label>'+t("subPeriod")+'</label><select id="s-ps-period"><option value="weekly"'+(appSettings.providerSubscription&&appSettings.providerSubscription.period==="weekly"?" selected":"")+'>'+t("periodWeekly")+'</option><option value="monthly"'+((appSettings.providerSubscription&&appSettings.providerSubscription.period==="monthly")||(!appSettings.providerSubscription||!appSettings.providerSubscription.period)?" selected":"")+'>'+t("periodMonthly")+'</option><option value="quarterly"'+(appSettings.providerSubscription&&appSettings.providerSubscription.period==="quarterly"?" selected":"")+'>'+t("periodQuarterly")+'</option><option value="yearly"'+(appSettings.providerSubscription&&appSettings.providerSubscription.period==="yearly"?" selected":"")+'>'+t("periodYearly")+'</option></select></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-ps-freeTrialEnabled"'+(appSettings.providerSubscription&&appSettings.providerSubscription.freeTrialEnabled?" checked":"")+'> '+t("freeTrialEnabledLabel")+'</label></div>'+
    '<div class="form-group"><label>'+t("freeTrialTextArLabel")+'</label><input id="s-ps-freeTrialTextAr" value="'+esc(appSettings.providerSubscription&&appSettings.providerSubscription.freeTrialTextAr||"")+'"></div>'+
    '<div class="form-group"><label>'+t("freeTrialTextEnLabel")+'</label><input id="s-ps-freeTrialTextEn" value="'+esc(appSettings.providerSubscription&&appSettings.providerSubscription.freeTrialTextEn||"")+'"></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("driverSubSettings")+'</h3>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-ds-active"'+(appSettings.driverSubscription&&appSettings.driverSubscription.active?" checked":"")+'> '+t("subActive")+'</label></div>'+
    '<div class="form-group"><label>'+t("subPrice")+'</label><input type="number" min="0" step="0.5" id="s-ds-price" value="'+(appSettings.driverSubscription&&appSettings.driverSubscription.price!=null?appSettings.driverSubscription.price:15)+'"></div>'+
    '<div class="form-group"><label>'+t("subPeriod")+'</label><select id="s-ds-period"><option value="weekly"'+(appSettings.driverSubscription&&appSettings.driverSubscription.period==="weekly"?" selected":"")+'>'+t("periodWeekly")+'</option><option value="monthly"'+((appSettings.driverSubscription&&appSettings.driverSubscription.period==="monthly")||(!appSettings.driverSubscription||!appSettings.driverSubscription.period)?" selected":"")+'>'+t("periodMonthly")+'</option><option value="quarterly"'+(appSettings.driverSubscription&&appSettings.driverSubscription.period==="quarterly"?" selected":"")+'>'+t("periodQuarterly")+'</option><option value="yearly"'+(appSettings.driverSubscription&&appSettings.driverSubscription.period==="yearly"?" selected":"")+'>'+t("periodYearly")+'</option></select></div>'+
    '<div class="form-group"><label class="toggle"><input type="checkbox" id="s-ds-freeTrialEnabled"'+(appSettings.driverSubscription&&appSettings.driverSubscription.freeTrialEnabled?" checked":"")+'> '+t("freeTrialEnabledLabel")+'</label></div>'+
    '<div class="form-group"><label>'+t("freeTrialTextArLabel")+'</label><input id="s-ds-freeTrialTextAr" value="'+esc(appSettings.driverSubscription&&appSettings.driverSubscription.freeTrialTextAr||"")+'"></div>'+
    '<div class="form-group"><label>'+t("freeTrialTextEnLabel")+'</label><input id="s-ds-freeTrialTextEn" value="'+esc(appSettings.driverSubscription&&appSettings.driverSubscription.freeTrialTextEn||"")+'"></div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+(lang==="ar"?"\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A Apple":"Apple Subscriptions")+'</h3>'+
    '<p style="font-size:13px;color:var(--text2);margin-bottom:16px">'+(lang==="ar"?"\u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0623\u062F\u0646\u0627\u0647 \u0645\u0646 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642. \u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064A \u0648\u0645\u062F\u0629 \u0627\u0644\u0641\u0648\u062A\u0631\u0629 \u0648\u0634\u0631\u0648\u0637 \u0627\u0644\u062A\u062C\u062F\u064A\u062F \u0641\u064A iOS \u062A\u062A\u062D\u0643\u0645 \u0628\u0647\u0627 Apple App Store Connect.":"The information below is from App Configuration. Final iOS price, billing duration, renewal, cancellation, and entitlement terms are controlled by Apple App Store Connect.")+'</p>'+
    '<div class="grid-2">'+
    '<div style="padding:14px;border:1px solid var(--border);border-radius:10px"><strong>'+(lang==="ar"?"\u0645\u0642\u062F\u0645 \u0627\u0644\u062E\u062F\u0645\u0629":"Provider")+'</strong><div style="font-size:12px;color:var(--text2);margin-top:8px">App Configuration</div><div style="margin-top:4px"><code>tabbakheen_provider_monthly</code></div><div style="margin-top:6px">'+(lang==="ar"?"\u0627\u0644\u062F\u0648\u0631: \u0645\u0642\u062F\u0645 \u062E\u062F\u0645\u0629":"Role: Provider")+'</div><div>'+(lang==="ar"?"\u0645\u0641\u0639\u0651\u0644: ":"Configured: ")+(appSettings.providerSubscription&&appSettings.providerSubscription.active?(lang==="ar"?"\u0646\u0639\u0645":"Yes"):(lang==="ar"?"\u0644\u0627":"No"))+'</div></div>'+
    '<div style="padding:14px;border:1px solid var(--border);border-radius:10px"><strong>'+(lang==="ar"?"\u0627\u0644\u0633\u0627\u0626\u0642":"Driver")+'</strong><div style="font-size:12px;color:var(--text2);margin-top:8px">App Configuration</div><div style="margin-top:4px"><code>tabbakheen_driver_monthly</code></div><div style="margin-top:6px">'+(lang==="ar"?"\u0627\u0644\u062F\u0648\u0631: \u0633\u0627\u0626\u0642":"Role: Driver")+'</div><div>'+(lang==="ar"?"\u0645\u0641\u0639\u0651\u0644: ":"Configured: ")+(appSettings.driverSubscription&&appSettings.driverSubscription.active?(lang==="ar"?"\u0646\u0639\u0645":"Yes"):(lang==="ar"?"\u0644\u0627":"No"))+'</div></div>'+
    '</div>'+
    '<div style="margin-top:14px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px;color:#9a3412">'+(lang==="ar"?"Apple / StoreKit: \u0644\u0627 \u062A\u062A\u0648\u0641\u0631 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u0645\u0648\u062B\u0648\u0642\u0629 \u0645\u0646 App Store Connect \u062F\u0627\u062E\u0644 \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629 \u062D\u0627\u0644\u064A\u0627\u064B. \u0644\u0627 \u062A\u064F\u0639\u062F \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0645\u062F\u062E\u0644\u0629 \u0641\u064A \u0627\u0644\u0625\u062F\u0627\u0631\u0629 \u0623\u0633\u0639\u0627\u0631 Apple.":"Apple / StoreKit: Direct authoritative App Store Connect data is not currently available in Admin. Admin-entered prices are not Apple prices.")+'</div>'+
    '</div>'+
    '<div class="settings-section"><h3>'+t("changePassword")+'</h3>'+
    '<div id="pw-msg" class="success-msg"></div>'+
    '<div class="form-group"><label>'+t("currentPassword")+'</label><input type="password" id="s-curPw"></div>'+
    '<div class="form-group"><label>'+t("newPassword")+'</label><input type="password" id="s-newPw"></div>'+
    '<div class="form-group"><label>'+t("confirmNewPassword")+'</label><input type="password" id="s-confirmPw"></div>'+
    '<button class="btn btn-sm btn-warning" onclick="changePassword()">'+t("changePasswordBtn")+'</button>'+
    '</div>'+
    '<button class="btn btn-primary" onclick="saveSettings()">'+t("saveSettings")+'</button>';
  setTimeout(updatePricingPreview,50);
}

async function uploadBanner(){
  var fileInput=document.getElementById("banner-file");
  if(!fileInput.files.length){toast(t("selectFile"),"error");return;}
  var file=fileInput.files[0];
  var btn=document.getElementById("upload-btn");
  btn.disabled=true;btn.textContent=t("uploading");
  try{
    var reader=new FileReader();
    reader.onload=async function(){
      try{
        var base64=reader.result;
        var res=await fetch("/admin/api/upload-banner",{
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":"Bearer "+TOKEN},
          body:JSON.stringify({image:base64})
        });
        var data=await res.json();
        if(data.success&&data.url){
          document.getElementById("s-bannerImageUrl").value=data.url;
          toast(t("uploadSuccess"));
          await saveSettings();
          renderPage();
        }else{
          toast(t("uploadFailed")+": "+(data.error||"Unknown"),"error");
        }
      }catch(e){toast(t("uploadFailed")+": "+e.message,"error");}
      finally{btn.disabled=false;btn.textContent=t("upload");}
    };
    reader.readAsDataURL(file);
  }catch(e){toast(t("uploadFailed")+": "+e.message,"error");btn.disabled=false;btn.textContent=t("upload");}
}

async function saveSettings(){
  function numberValue(id,fallback){
    var el=document.getElementById(id);
    var parsed=el?parseFloat(el.value):fallback;
    return Number.isFinite(parsed)?parsed:fallback;
  }
  function integerValue(id,fallback){
    var el=document.getElementById(id);
    var parsed=el?parseInt(el.value,10):fallback;
    return Number.isFinite(parsed)?parsed:fallback;
  }
  var fields={
    bannerImageUrl:document.getElementById("s-bannerImageUrl")?document.getElementById("s-bannerImageUrl").value:"",
    bannerEnabled:document.getElementById("s-bannerEnabled")?document.getElementById("s-bannerEnabled").checked:true,
    supportEmail:document.getElementById("s-supportEmail")?document.getElementById("s-supportEmail").value:"",
    supportWhatsapp:document.getElementById("s-supportWhatsapp")?document.getElementById("s-supportWhatsapp").value:"",
    deliveryPricing:{
      currency:"SAR",
      baseFee:Math.max(0,numberValue("s-baseFee",5)),
      perKmInsideCity:Math.max(0,numberValue("s-perKmCity",2)),
      minFee:Math.max(0,numberValue("s-minFee",5)),
      maxFee:Math.max(0,numberValue("s-maxFee",50))
    },
    defaultLanguage:lang,
    subscriptionWarningDays:Math.max(0,integerValue("s-warningDays",7)),
    notifyOnNewUser:document.getElementById("s-notifyNewUser")?document.getElementById("s-notifyNewUser").checked:false,
    notifyOnNewProvider:document.getElementById("s-notifyNewProvider")?document.getElementById("s-notifyNewProvider").checked:false,
    notifyOnNewDriver:document.getElementById("s-notifyNewDriver")?document.getElementById("s-notifyNewDriver").checked:false,
    notifyOnCrVerification:document.getElementById("s-notifyCrVerification")?document.getElementById("s-notifyCrVerification").checked:false,
    notifyOnFreelanceRequest:document.getElementById("s-notifyFreelanceRequest")?document.getElementById("s-notifyFreelanceRequest").checked:false,
    providerSubscription:{
      active:document.getElementById("s-ps-active")?document.getElementById("s-ps-active").checked:false,
      price:Math.max(0,numberValue("s-ps-price",15)),
      period:document.getElementById("s-ps-period")?document.getElementById("s-ps-period").value:"monthly",
      freeTrialEnabled:document.getElementById("s-ps-freeTrialEnabled")?document.getElementById("s-ps-freeTrialEnabled").checked:false,
      freeTrialTextAr:document.getElementById("s-ps-freeTrialTextAr")?document.getElementById("s-ps-freeTrialTextAr").value:"",
      freeTrialTextEn:document.getElementById("s-ps-freeTrialTextEn")?document.getElementById("s-ps-freeTrialTextEn").value:""
    },
    driverSubscription:{
      active:document.getElementById("s-ds-active")?document.getElementById("s-ds-active").checked:false,
      price:Math.max(0,numberValue("s-ds-price",15)),
      period:document.getElementById("s-ds-period")?document.getElementById("s-ds-period").value:"monthly",
      freeTrialEnabled:document.getElementById("s-ds-freeTrialEnabled")?document.getElementById("s-ds-freeTrialEnabled").checked:false,
      freeTrialTextAr:document.getElementById("s-ds-freeTrialTextAr")?document.getElementById("s-ds-freeTrialTextAr").value:"",
      freeTrialTextEn:document.getElementById("s-ds-freeTrialTextEn")?document.getElementById("s-ds-freeTrialTextEn").value:""
    }
  };
  var dp=fields.deliveryPricing;if(dp&&dp.minFee>dp.maxFee&&dp.maxFee>0){toast(t("invalidMinMax"),"error");return;}
  if(dp&&(dp.baseFee<0||dp.perKmInsideCity<0||dp.minFee<0||dp.maxFee<0)){toast(t("noNegative"),"error");return;}
  var data=await api("/settings",{method:"POST",body:JSON.stringify(fields)});
  if(data&&data.success)toast(t("settingsSaved"));
  else toast(data&&data.error||t("failedSave"),"error");
}

async function changePassword(){
  var cur=document.getElementById("s-curPw").value;
  var newPw=document.getElementById("s-newPw").value;
  var confirmPw=document.getElementById("s-confirmPw").value;
  var msgEl=document.getElementById("pw-msg");
  if(!cur||!newPw){msgEl.textContent=t("enterPassword");msgEl.className="err-msg";msgEl.style.display="block";return;}
  if(newPw!==confirmPw){msgEl.textContent=t("passwordMismatch");msgEl.className="err-msg";msgEl.style.display="block";return;}
  try{
    var data=await api("/change-password",{method:"POST",body:JSON.stringify({currentPassword:cur,newPassword:newPw})});
    if(data&&data.success){
      msgEl.textContent=t("passwordChanged");msgEl.className="success-msg";msgEl.style.display="block";
      document.getElementById("s-curPw").value="";document.getElementById("s-newPw").value="";document.getElementById("s-confirmPw").value="";
    }else{msgEl.textContent=data&&data.error||t("passwordFailed");msgEl.className="err-msg";msgEl.style.display="block";}
  }catch(e){msgEl.textContent=e.message;msgEl.className="err-msg";msgEl.style.display="block";}
}

function updatePricingPreview(){
  var baseFee=parseFloat(document.getElementById("s-baseFee")?document.getElementById("s-baseFee").value:"5")||0;
  var perKm=parseFloat(document.getElementById("s-perKmCity")?document.getElementById("s-perKmCity").value:"2")||0;
  var minFee=parseFloat(document.getElementById("s-minFee")?document.getElementById("s-minFee").value:"5")||0;
  var maxFee=parseFloat(document.getElementById("s-maxFee")?document.getElementById("s-maxFee").value:"50")||0;
  var validEl=document.getElementById("pricing-validation");
  var prevEl=document.getElementById("pricing-preview");
  if(!validEl||!prevEl)return;
  var errors=[];
  if(baseFee<0||perKm<0||minFee<0||maxFee<0)errors.push(t("noNegative"));
  if(minFee>maxFee&&maxFee>0)errors.push(t("invalidMinMax"));
  if(errors.length){validEl.innerHTML='<div style="color:var(--error);font-size:13px;padding:8px;background:#fef2f2;border-radius:6px">'+errors.join("<br>")+'</div>';}
  else{validEl.innerHTML="";}
  var examples=[3,5,7.5,10,15,20];
  var html='<div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:10px">'+t("formulaPreview")+'</div>';
  html+='<table style="width:100%;font-size:13px;border-collapse:collapse">';
  html+='<tr style="background:#e0f2e9"><th style="padding:6px 10px;text-align:'+( lang==="ar"?"right":"left")+'>'+t("distance")+' (km)</th><th style="padding:6px 10px;text-align:'+( lang==="ar"?"right":"left")+'>'+t("estimatedFee")+' (SAR)</th></tr>';
  examples.forEach(function(d){
    var fee=baseFee+d*perKm;
    fee=Math.round(fee);
    if(minFee>0&&fee<minFee)fee=minFee;
    if(maxFee>0&&fee>maxFee)fee=maxFee;
    html+='<tr><td style="padding:5px 10px;border-bottom:1px solid #d1fae5">'+d+' km</td><td style="padding:5px 10px;border-bottom:1px solid #d1fae5;font-weight:600">'+fee+' SAR</td></tr>';
  });
  html+='</table>';
  prevEl.innerHTML=html;
}

var _bcSourceId=null;
var _bcSending=false;
var _bcHistoryData={};
var _bcActionId=null;
async function renderNotifications(c){
  var data=await api("/broadcast-notifications/history");
  var history=(data&&data.history)||[];
  var audienceOptions=[
    {value:"customer",label:t("audienceCustomers")},
    {value:"provider",label:t("audienceProviders")},
    {value:"driver",label:t("audienceDrivers")},
    {value:"all",label:t("audienceAll")}
  ];
  var optHtml=audienceOptions.map(function(o){return'<option value="'+o.value+'">'+esc(o.label)+'</option>';}).join("");
  _bcHistoryData={};
  history.forEach(function(h){if(h&&h._id)_bcHistoryData[h._id]=h;});
  var histRows=history.map(function(h){
    var d=h.createdAt?new Date(h.createdAt).toLocaleString():"-";
    var audMap={customer:t("audienceCustomers"),provider:t("audienceProviders"),driver:t("audienceDrivers"),all:t("audienceAll")};
    var hid=h._id||"";
    var reasons=h.failureReasons&&typeof h.failureReasons==="object"?Object.keys(h.failureReasons).map(function(code){var item=h.failureReasons[code]||{};return esc(code)+" ("+esc(String(item.count||0))+")"+(item.message?": "+esc(item.message):"");}).join("<br>"):"-";
    return '<tr>'+
      '<td style="font-size:12px;color:var(--text2)">'+esc(d)+'</td>'+
      '<td><strong>'+esc(h.title||"-")+'</strong><div style="font-size:12px;color:var(--text2)">'+esc(h.message||"")+'</div></td>'+
      '<td>'+esc(audMap[h.audience]||h.audience||"-")+'</td>'+
      '<td style="text-align:center">'+esc(String(h.totalCandidateTokens||h.validTokensCount||0))+'</td>'+
      '<td style="text-align:center">'+esc(String(h.validTokensCount||0))+'</td>'+
      '<td style="text-align:center;color:var(--success)">'+esc(String(h.sentCount||0))+'</td>'+
      '<td style="text-align:center;color:var(--error)">'+esc(String(h.failedCount||0))+'</td>'+
      '<td style="text-align:center;color:var(--error)">'+esc(String((h.invalidTokensCount||0)+(h.staleTokensCount||0)))+'</td>'+
      '<td style="font-size:11px;max-width:260px">'+reasons+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button data-id="'+hid+'" class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin:2px" onclick="deleteNotification(this.dataset.id)">'+t("deleteNotif")+'</button>'+
        '<button data-id="'+hid+'" class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin:2px" onclick="resendNotification(this.dataset.id)">'+t("resendNotif")+'</button>'+
        '<button data-id="'+hid+'" class="btn btn-orange" style="padding:4px 8px;font-size:11px;margin:2px" onclick="editAndResend(this.dataset.id)">'+t("editResend")+'</button>'+
      '</td>'+
      '</tr>';
  }).join("");
  c.innerHTML=
    '<h1 class="page-title">'+t("notifications")+'</h1>'+
    '<div class="settings-section">'+
    '<h3>'+t("broadcastSend")+'</h3>'+
    '<div class="form-group"><label>'+t("broadcastTitle")+' *</label>'+
    '<input type="text" id="bc-title" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px" placeholder="'+t("broadcastTitle")+'"></div>'+
    '<div class="form-group"><label>'+t("broadcastMessage")+' *</label>'+
    '<textarea id="bc-message" rows="4" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;resize:vertical" placeholder="'+t("broadcastMessage")+'"></textarea></div>'+
    '<div class="form-group"><label>'+t("broadcastAudience")+' *</label>'+
    '<select id="bc-audience" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px"><option value="">-- '+t("broadcastAudience")+' --</option>'+optHtml+'</select></div>'+
    '<div id="bc-result" style="display:none;padding:12px;border-radius:8px;margin-bottom:12px"></div>'+
    '<button id="bc-send-btn" class="btn btn-orange" onclick="confirmBroadcast()">'+t("broadcastSend")+'</button>'+
    '</div>'+
    '<div class="settings-section">'+
    '<h3>'+t("broadcastHistory")+'</h3>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr>'+
    '<th>'+t("date")+'</th>'+
    '<th>'+t("broadcastTitle")+'</th>'+
    '<th>'+t("broadcastAudienceLabel")+'</th>'+
    '<th>'+(lang==="ar"?"\u0627\u0644\u0645\u0631\u0634\u062D\u0629":"Candidates")+'</th>'+
    '<th>'+t("broadcastTokens")+'</th>'+
    '<th>'+t("broadcastSentCount")+'</th>'+
    '<th>'+t("broadcastFailed")+'</th>'+
    '<th>'+(lang==="ar"?"\u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629/\u0642\u062F\u064A\u0645\u0629":"Invalid/Stale")+'</th>'+
    '<th>'+(lang==="ar"?"\u0633\u0628\u0628 \u0627\u0644\u0641\u0634\u0644":"Failure reason")+'</th>'+
    '<th>'+t("actions")+'</th>'+
    '</tr></thead>'+
    '<tbody>'+(histRows||'<tr><td colspan="10" class="empty">'+t("noBroadcastHistory")+'</td></tr>')+'</tbody>'+
    '</table></div>'+
    '</div>';
}
function confirmBroadcast(){
  var title=document.getElementById("bc-title")?document.getElementById("bc-title").value.trim():"";
  var message=document.getElementById("bc-message")?document.getElementById("bc-message").value.trim():"";
  var audience=document.getElementById("bc-audience")?document.getElementById("bc-audience").value:"";
  var resultEl=document.getElementById("bc-result");
  if(!title||!message||!audience){
    if(resultEl){resultEl.style.display="block";resultEl.style.background="#fef2f2";resultEl.style.color="var(--error)";resultEl.textContent=t("broadcastTitle")+" / "+t("broadcastMessage")+" / "+t("broadcastAudience");}
    return;
  }
  var audMap={customer:t("audienceCustomers"),provider:t("audienceProviders"),driver:t("audienceDrivers"),all:t("audienceAll")};
  openModal(
    '<h3 style="margin-bottom:12px">'+t("broadcastConfirm")+'</h3>'+
    '<p style="margin-bottom:8px">'+t("broadcastConfirmMsg")+'</p>'+
    '<p><strong>'+t("broadcastTitle")+':</strong> '+esc(title)+'</p>'+
    '<p style="margin-bottom:16px"><strong>'+t("broadcastAudienceLabel")+':</strong> '+esc(audMap[audience]||audience)+'</p>'+
    '<div class="modal-actions">'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button> '+
    '<button class="btn btn-orange" onclick="doSendBroadcast()">'+t("broadcastSend")+'</button>'+
    '</div>'
  );
}
async function doSendBroadcast(){
  closeModal();
  if(_bcSending)return;
  _bcSending=true;
  var sendBtn=document.getElementById("bc-send-btn");
  if(sendBtn)sendBtn.disabled=true;
  var title=document.getElementById("bc-title")?document.getElementById("bc-title").value.trim():"";
  var message=document.getElementById("bc-message")?document.getElementById("bc-message").value.trim():"";
  var audience=document.getElementById("bc-audience")?document.getElementById("bc-audience").value:"";
  var resultEl=document.getElementById("bc-result");
  if(resultEl){resultEl.style.display="block";resultEl.style.background="#eff6ff";resultEl.style.color="var(--info)";resultEl.textContent=t("loading");}
  var payload={title:title,message:message,audience:audience};
  if(_bcSourceId){payload.sourceNotificationId=_bcSourceId;payload.resendType="edited";}
  var data=await api("/broadcast-notifications/send",{method:"POST",body:JSON.stringify(payload)});
  _bcSending=false;
  _bcSourceId=null;
  if(sendBtn){sendBtn.disabled=false;sendBtn.textContent=t("broadcastSend");}
  if(!data){if(resultEl){resultEl.style.background="#fef2f2";resultEl.style.color="var(--error)";resultEl.textContent=t("connectionError");}return;}
  if(data.success){
    if(resultEl){
      resultEl.style.background="#f0fdf4";resultEl.style.color="var(--success)";
      resultEl.innerHTML=
        '<strong>'+t("broadcastResult")+'</strong><br>'+
        t("broadcastMatched")+': <strong>'+esc(String(data.totalUsersMatched||0))+'</strong><br>'+
        (lang==="ar"?"\u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0645\u0631\u0634\u062D\u0629":"Candidate tokens")+': <strong>'+esc(String(data.totalCandidateTokens||0))+'</strong><br>'+
        t("broadcastTokens")+': <strong>'+esc(String(data.validTokensCount||0))+'</strong><br>'+
        t("broadcastSentCount")+': <strong>'+esc(String(data.sentCount||0))+'</strong><br>'+
        t("broadcastFailed")+': <strong>'+esc(String(data.failedCount||0))+'</strong><br>'+
        (lang==="ar"?"\u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629/\u0642\u062F\u064A\u0645\u0629":"Invalid/Stale")+': <strong>'+esc(String((data.invalidTokensCount||0)+(data.staleTokensCount||0)))+'</strong><br>'+
        formatFailureReasons(data.failureReasons);
    }
    if(document.getElementById("bc-title"))document.getElementById("bc-title").value="";
    if(document.getElementById("bc-message"))document.getElementById("bc-message").value="";
    if(document.getElementById("bc-audience"))document.getElementById("bc-audience").value="";
    toast(t("broadcastResult"));
    setTimeout(function(){navigate("notifications");},600);
  }else{
    if(resultEl){resultEl.style.background="#fef2f2";resultEl.style.color="var(--error)";resultEl.textContent=data.error||t("broadcastFailed");}
    toast(data.error||t("broadcastFailed"),"error");
  }
}
function formatFailureReasons(reasons){
  if(!reasons||typeof reasons!=="object"||!Object.keys(reasons).length)return "";
  return Object.keys(reasons).map(function(code){var item=reasons[code]||{};return '<span style="font-size:12px">'+esc(code)+' ('+esc(String(item.count||0))+')'+(item.message?': '+esc(item.message):"")+'</span>';}).join("<br>");
}
function deleteNotification(id){
  if(_bcSending)return;
  var h=_bcHistoryData[id];
  if(!h)return;
  _bcActionId=id;
  var audMap={customer:t("audienceCustomers"),provider:t("audienceProviders"),driver:t("audienceDrivers"),all:t("audienceAll")};
  openModal(
    '<h3 style="margin-bottom:12px">'+t("confirmDelete")+'</h3>'+
    '<p style="margin-bottom:8px">'+t("confirmDeleteMsg")+'</p>'+
    '<p><strong>'+t("broadcastTitle")+':</strong> '+esc(h.title||"-")+'</p>'+
    '<p style="margin-bottom:16px"><strong>'+t("broadcastAudienceLabel")+':</strong> '+esc(audMap[h.audience]||h.audience||"-")+'</p>'+
    '<div class="modal-actions">'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button> '+
    '<button class="btn" style="background:#ef4444;color:#fff;padding:8px 16px" onclick="doDeleteNotification()">'+t("deleteNotif")+'</button>'+
    '</div>'
  );
}
async function doDeleteNotification(){
  var id=_bcActionId;
  closeModal();
  if(!id)return;
  _bcSending=true;
  var data=await api("/broadcast-notifications/"+id,{method:"DELETE"});
  _bcSending=false;
  _bcActionId=null;
  if(!data){toast(t("connectionError"),"error");return;}
  if(data.success){toast(t("notifDeleted"));setTimeout(function(){navigate("notifications");},400);}
  else{toast(data.error||t("deleteFailed"),"error");}
}
function resendNotification(id){
  if(_bcSending)return;
  var h=_bcHistoryData[id];
  if(!h)return;
  _bcActionId=id;
  var audMap={customer:t("audienceCustomers"),provider:t("audienceProviders"),driver:t("audienceDrivers"),all:t("audienceAll")};
  openModal(
    '<h3 style="margin-bottom:12px">'+t("confirmResend")+'</h3>'+
    '<p style="margin-bottom:8px">'+t("confirmResendMsg")+'</p>'+
    '<p><strong>'+t("broadcastTitle")+':</strong> '+esc(h.title||"-")+'</p>'+
    '<p style="margin-bottom:16px"><strong>'+t("broadcastAudienceLabel")+':</strong> '+esc(audMap[h.audience]||h.audience||"-")+'</p>'+
    '<div class="modal-actions">'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("cancel")+'</button> '+
    '<button class="btn btn-orange" onclick="doResendNotification()">'+t("resendNotif")+'</button>'+
    '</div>'
  );
}
async function doResendNotification(){
  var id=_bcActionId;
  closeModal();
  if(!id||_bcSending)return;
  _bcSending=true;
  var sendBtn=document.getElementById("bc-send-btn");
  if(sendBtn)sendBtn.disabled=true;
  var resultEl=document.getElementById("bc-result");
  if(resultEl){resultEl.style.display="block";resultEl.style.background="#eff6ff";resultEl.style.color="var(--info)";resultEl.textContent=t("loading");}
  var data=await api("/broadcast-notifications/"+id+"/resend",{method:"POST",body:JSON.stringify({})});
  _bcSending=false;
  _bcActionId=null;
  if(sendBtn)sendBtn.disabled=false;
  if(!data){if(resultEl){resultEl.style.background="#fef2f2";resultEl.style.color="var(--error)";resultEl.textContent=t("connectionError");}return;}
  if(data.success){
    if(resultEl){
      resultEl.style.background="#f0fdf4";resultEl.style.color="var(--success)";
      resultEl.innerHTML=
        '<strong>'+t("broadcastResult")+'</strong><br>'+
        t("broadcastMatched")+': <strong>'+esc(String(data.totalUsersMatched||0))+'</strong><br>'+
        (lang==="ar"?"\u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0645\u0631\u0634\u062D\u0629":"Candidate tokens")+': <strong>'+esc(String(data.totalCandidateTokens||0))+'</strong><br>'+
        t("broadcastTokens")+': <strong>'+esc(String(data.validTokensCount||0))+'</strong><br>'+
        t("broadcastSentCount")+': <strong>'+esc(String(data.sentCount||0))+'</strong><br>'+
        t("broadcastFailed")+': <strong>'+esc(String(data.failedCount||0))+'</strong><br>'+
        (lang==="ar"?"\u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629/\u0642\u062F\u064A\u0645\u0629":"Invalid/Stale")+': <strong>'+esc(String((data.invalidTokensCount||0)+(data.staleTokensCount||0)))+'</strong><br>'+
        formatFailureReasons(data.failureReasons);
    }
    toast(t("resendSuccess"));
    setTimeout(function(){navigate("notifications");},600);
  }else{
    if(resultEl){resultEl.style.background="#fef2f2";resultEl.style.color="var(--error)";resultEl.textContent=data.error||t("resendFailed");}
    toast(data.error||t("resendFailed"),"error");
  }
}
function editAndResend(id){
  if(_bcSending)return;
  var h=_bcHistoryData[id];
  if(!h)return;
  _bcSourceId=id;
  var titleEl=document.getElementById("bc-title");
  var msgEl=document.getElementById("bc-message");
  var audEl=document.getElementById("bc-audience");
  var sendBtn=document.getElementById("bc-send-btn");
  if(titleEl)titleEl.value=h.title||"";
  if(msgEl)msgEl.value=h.message||"";
  if(audEl)audEl.value=h.audience||"";
  if(sendBtn)sendBtn.textContent=t("editResendSend");
  if(titleEl)titleEl.scrollIntoView({behavior:"smooth",block:"center"});
}

if(lang==="ar"){document.documentElement.dir="rtl";document.documentElement.lang="ar";}
else{document.documentElement.dir="ltr";document.documentElement.lang="en";}
updateStaticLabels();
initSidebar();
if(TOKEN){
  api("/stats").then(function(d){if(d){showMain();updateMobilePageName();}else showLogin();}).catch(function(){showLogin();});
}else{showLogin();}
window.addEventListener("resize",function(){if(window.innerWidth>768){var sb=document.getElementById("sidebar");if(sb){sb.classList.remove("open");sb.style.visibility="";sb.style.pointerEvents="";}}else{var sb2=document.getElementById("sidebar");if(sb2&&!sb2.classList.contains("open")){sb2.style.visibility="hidden";sb2.style.pointerEvents="none";}closeSidebar();}});
window.addEventListener("pageshow",function(){if(isMobile()){forceSidebarClosed();}});
<\/script>
</body>
</html>`;
    }
    __name(getAdminHTML, "getAdminHTML");
    __name2(getAdminHTML, "getAdminHTML");
    addEventListener("fetch", (event) => {
      event.respondWith(handleRequest(event.request, event));
    });
    async function handleRequest(request) {
      const env = typeof globalThis !== "undefined" ? globalThis : {};
      try {
        if (typeof FIREBASE_CLIENT_EMAIL !== "undefined") env.FIREBASE_CLIENT_EMAIL = FIREBASE_CLIENT_EMAIL;
      } catch {
      }
      try {
        if (typeof FIREBASE_PRIVATE_KEY !== "undefined") env.FIREBASE_PRIVATE_KEY = FIREBASE_PRIVATE_KEY;
      } catch {
      }
      try {
        if (typeof API_KEY !== "undefined") env.API_KEY = API_KEY;
      } catch {
      }
      try {
        if (typeof WATHQ_API_KEY !== "undefined") env.WATHQ_API_KEY = WATHQ_API_KEY;
      } catch {
      }
      try {
        if (typeof ADMIN_PASSWORD !== "undefined") env.ADMIN_PASSWORD = ADMIN_PASSWORD;
      } catch {
      }
      try {
        if (typeof ADMIN_TOKEN_SECRET !== "undefined") env.ADMIN_TOKEN_SECRET = ADMIN_TOKEN_SECRET;
      } catch {
      }
      try {
        if (typeof CLOUDINARY_CLOUD_NAME !== "undefined") env.CLOUDINARY_CLOUD_NAME = CLOUDINARY_CLOUD_NAME;
      } catch {
      }
      try {
        if (typeof CLOUDINARY_API_KEY !== "undefined") env.CLOUDINARY_API_KEY = CLOUDINARY_API_KEY;
      } catch {
      }
      try {
        if (typeof CLOUDINARY_API_SECRET !== "undefined") env.CLOUDINARY_API_SECRET = CLOUDINARY_API_SECRET;
      } catch {
      }
      try {
        if (typeof EMAIL_API_KEY !== "undefined") env.EMAIL_API_KEY = EMAIL_API_KEY;
      } catch {
      }
      try {
        if (typeof EMAIL_FROM !== "undefined") env.EMAIL_FROM = EMAIL_FROM;
      } catch {
      }
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-api-key, Authorization"
          }
        });
      }
      if (path === "/" && request.method === "GET") {
        return Response.json({ status: "ok", service: "tabbakheen-api", version: "2.2.0", admin: true, pdf: true, deliveryPricingAdmin: true });
      }
      if (path === "/admin" || path === "/admin/") {
        return new Response(getAdminHTML(), {
          headers: { "Content-Type": "text/html;charset=UTF-8" }
        });
      }
      const invoiceViewMatch = path.match(/^\/admin\/invoice\/([^/]+)$/);
      if (invoiceViewMatch && request.method === "GET") {
        const invoiceId = invoiceViewMatch[1];
        const signedToken = url.searchParams.get("token");
        const valid = await verifySignedInvoiceToken(signedToken, invoiceId, env);
        if (!valid) {
          return new Response("Unauthorized - invalid or expired invoice token", { status: 401 });
        }
        try {
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const invoice = await getFirestoreDoc("invoices", invoiceId, accessToken);
          if (!invoice) {
            return new Response("Invoice not found", { status: 404 });
          }
          const invoiceLang = url.searchParams.get("lang") || "ar";
          const html = generateInvoiceHTML(invoice, invoiceLang);
          return new Response(html, {
            headers: { "Content-Type": "text/html;charset=UTF-8" }
          });
        } catch (e) {
          return new Response("Error: " + e.message, { status: 500 });
        }
      }
      const invoicePdfMatch = path.match(/^\/admin\/invoice\/([^/]+)\/pdf$/);
      if (invoicePdfMatch && request.method === "GET") {
        const invoiceId = invoicePdfMatch[1];
        const signedToken = url.searchParams.get("token");
        const valid = await verifySignedInvoiceToken(signedToken, invoiceId, env);
        if (!valid) {
          return new Response("Unauthorized - invalid or expired invoice token", { status: 401 });
        }
        try {
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const invoice = await getFirestoreDoc("invoices", invoiceId, accessToken);
          if (!invoice) {
            return new Response("Invoice not found", { status: 404 });
          }
          const invoiceLang = url.searchParams.get("lang") || "ar";
          const pdfBytes = generatePDFBytes(invoice, invoiceLang);
          const filename = "invoice-" + (invoice.invoiceNumber || invoiceId) + ".pdf";
          return new Response(pdfBytes, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'attachment; filename="' + filename + '"',
              "Content-Length": String(pdfBytes.length)
            }
          });
        } catch (e) {
          console.error("[Invoice PDF] Error:", e);
          return new Response("Error generating PDF: " + e.message, { status: 500 });
        }
      }
      if (path === "/admin/api/login" && request.method === "POST") {
        try {
          const body = await request.json();
          if (!body.password) {
            return jsonResponse({ error: "Password required" }, 401);
          }
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const valid = await verifyAdminPassword(body.password, env, accessToken);
          if (!valid) {
            return jsonResponse({ error: "Invalid password" }, 401);
          }
          const token = await createAdminToken(env);
          console.log("[Admin] Login successful");
          return jsonResponse({ success: true, token });
        } catch (e) {
          console.error("[Admin] Login error:", e);
          return jsonResponse({ error: "Login failed: " + e.message }, 500);
        }
      }
      if (path.startsWith("/admin/api/")) {
        const token = getTokenFromRequest(request);
        const valid = await verifyAdminToken(token, env);
        if (!valid) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        try {
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          if (path === "/admin/api/stats" && request.method === "GET") {
            const [users, orders, offers] = await Promise.all([
              listAllUsers(accessToken),
              listAllOrders(accessToken),
              listAllOffers(accessToken)
            ]);
            const stats = {
              totalUsers: users.length,
              customers: users.filter((u) => u.role === "customer").length,
              providers: users.filter((u) => u.role === "provider").length,
              drivers: users.filter((u) => u.role === "driver").length,
              providersInTrial: users.filter((u) => u.role === "provider" && (u.accountStatus === "trial" || u.subscriptionStatus === "trialing")).length,
              driversInTrial: users.filter((u) => u.role === "driver" && (u.accountStatus === "trial" || u.subscriptionStatus === "trialing")).length,
              suspendedAccounts: users.filter((u) => u.accountStatus === "suspended" || u.accountStatus === "disabled").length,
              activeSubscriptions: users.filter((u) => u.subscriptionStatus === "active").length
            };
            return jsonResponse({ success: true, stats, users, orders, offers });
          }
          if (path === "/admin/api/users" && request.method === "GET") {
            const users = await listAllUsers(accessToken);
            return jsonResponse({ success: true, users });
          }
          if (path === "/admin/api/complaints" && request.method === "GET") {
            const complaints = await listAllComplaints(accessToken);
            const users = await listAllUsers(accessToken);
            const userMap = {};
            for (const user of users) {
              if (user && user._id) userMap[user._id] = {
                uid: user._id,
                displayName: user.displayName || "",
                email: user.email || "",
                phone: user.phone || ""
              };
            }
            const enriched = complaints.map((complaint) => {
              const person = /* @__PURE__ */ __name((uid) => uid ? userMap[uid] || { uid, displayName: "", email: "", phone: "" } : { uid: "", displayName: "", email: "", phone: "" }, "person");
              return {
                ...complaint,
                customer: person(complaint.customerUid),
                provider: person(complaint.providerUid),
                driver: person(complaint.driverUid),
                id: complaint._id || complaint.id
              };
            }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
            return jsonResponse({ success: true, complaints: enriched });
          }
          const complaintDetailMatch = path.match(/^\/admin\/api\/complaints\/([^/]+)$/);
          if (complaintDetailMatch && request.method === "GET") {
            const complaintId = decodeURIComponent(complaintDetailMatch[1]);
            const complaint = await getFirestoreDoc("delivery_complaints", complaintId, accessToken);
            if (!complaint) return jsonResponse({ error: "Complaint not found" }, 404);
            const users = await listAllUsers(accessToken);
            const userMap = {};
            for (const user of users) {
              if (user && user._id) userMap[user._id] = { uid: user._id, displayName: user.displayName || "", email: user.email || "", phone: user.phone || "" };
            }
            const person = /* @__PURE__ */ __name((uid) => uid ? userMap[uid] || { uid, displayName: "", email: "", phone: "" } : { uid: "", displayName: "", email: "", phone: "" }, "person");
            return jsonResponse({ success: true, complaint: {
              ...complaint,
              id: complaint._id || complaint.id || complaintId,
              customer: person(complaint.customerUid),
              provider: person(complaint.providerUid),
              driver: person(complaint.driverUid)
            } });
          }
          const complaintUpdateMatch = path.match(/^\/admin\/api\/complaints\/([^/]+)\/update$/);
          if (complaintUpdateMatch && request.method === "POST") {
            const complaintId = decodeURIComponent(complaintUpdateMatch[1]);
            const body = await request.json();
            const fields = {};
            if ("complaintStatus" in body) {
              const complaintStatus = String(body.complaintStatus || "");
              if (!["pending", "resolved", "closed"].includes(complaintStatus)) return jsonResponse({ error: "Invalid complaint status" }, 400);
              fields.complaintStatus = complaintStatus;
            }
            if ("adminNote" in body) fields.adminNote = String(body.adminNote || "").slice(0, 4e3);
            if (Object.keys(fields).length === 0) return jsonResponse({ error: "No valid complaint fields" }, 400);
            fields.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            await updateFirestoreDocument("delivery_complaints", complaintId, fields, accessToken);
            return jsonResponse({ success: true, updated: Object.keys(fields) });
          }
          const userUpdateMatch = path.match(/^\/admin\/api\/users\/([^/]+)\/update$/);
          if (userUpdateMatch && request.method === "POST") {
            const uid = userUpdateMatch[1];
            const body = await request.json();
            const allowed = [
              "accountStatus",
              "subscriptionStatus",
              "subscriptionPlan",
              "trialEndsAt",
              "subscriptionEndsAt",
              "activatedByAdmin",
              "disabledReason",
              "approvedByAdmin",
              "isApproved",
              "disabledAt",
              "subscriptionMeta"
            ];
            const fields = {};
            for (const key of allowed) {
              if (key in body) fields[key] = body[key];
            }
            if (Object.keys(fields).length === 0) {
              return jsonResponse({ error: "No valid fields" }, 400);
            }
            await updateFirestoreDocument("users", uid, fields, accessToken);
            return jsonResponse({ success: true, updated: Object.keys(fields) });
          }
          if (path === "/admin/api/verification" && request.method === "GET") {
            const users = await listAllUsers(accessToken);
            const providers = users.filter((u) => u.role === "provider");
            const items = [];
            for (const u of providers) {
              let verification = null;
              try {
                verification = await getFirestoreDoc("verifications", u._id, accessToken);
              } catch (e) {
                verification = null;
              }
              items.push({
                uid: u._id,
                displayName: u.displayName || "",
                email: u.email || "",
                phone: u.phone || "",
                verificationStatus: u.verificationStatus || "none",
                verificationSource: u.verificationSource || "",
                verifiedAt: u.verifiedAt || "",
                verification
              });
            }
            return jsonResponse({ success: true, items });
          }
          const flApproveMatch = path.match(/^\/admin\/api\/verification\/freelance\/([^/]+)\/approve$/);
          if (flApproveMatch && request.method === "POST") {
            const uid = flApproveMatch[1];
            const now = (/* @__PURE__ */ new Date()).toISOString();
            const vdoc = await getFirestoreDoc("verifications", uid, accessToken);
            const fc = vdoc && vdoc.freelanceCertificate ? vdoc.freelanceCertificate : {};
            fc.reviewStatus = "approved";
            fc.reviewedAt = now;
            await updateFirestoreDocument("verifications", uid, { freelanceCertificate: fc }, accessToken);
            await updateFirestoreDocument("users", uid, {
              verificationStatus: "verified",
              verificationSource: "freelance_certificate",
              verifiedAt: now
            }, accessToken);
            return jsonResponse({ success: true });
          }
          const flRejectMatch = path.match(/^\/admin\/api\/verification\/freelance\/([^/]+)\/reject$/);
          if (flRejectMatch && request.method === "POST") {
            const uid = flRejectMatch[1];
            const now = (/* @__PURE__ */ new Date()).toISOString();
            let note = "";
            try {
              const body = await request.json();
              note = String(body && body.note ? body.note : "").slice(0, 500);
            } catch (e) {
              note = "";
            }
            const vdoc = await getFirestoreDoc("verifications", uid, accessToken);
            const fc = vdoc && vdoc.freelanceCertificate ? vdoc.freelanceCertificate : {};
            fc.reviewStatus = "rejected";
            fc.reviewedAt = now;
            fc.internalReviewNote = note;
            await updateFirestoreDocument("verifications", uid, { freelanceCertificate: fc }, accessToken);
            const udoc = await getFirestoreDoc("users", uid, accessToken);
            const curSource = udoc && udoc.verificationSource ? udoc.verificationSource : "";
            const curStatus = udoc && udoc.verificationStatus ? udoc.verificationStatus : "";
            if (curSource === "freelance_certificate" || curStatus === "pending_review") {
              await updateFirestoreDocument("users", uid, {
                verificationStatus: "unverified",
                verificationSource: ""
              }, accessToken);
            }
            return jsonResponse({ success: true });
          }
          if (path === "/admin/api/settings" && request.method === "GET") {
            const settings = await getFirestoreDoc("app_settings", "main", accessToken);
            return jsonResponse({ success: true, settings: settings || {} });
          }
          if (path === "/admin/api/settings" && request.method === "POST") {
            const body = await request.json();
            if ("supportWhatsapp" in body) {
              const normalizedWhatsapp = normalizeSaudiWhatsApp(body.supportWhatsapp);
              if (normalizedWhatsapp === null) {
                return jsonResponse({ error: "Support WhatsApp must be a Saudi number such as 9665XXXXXXXX or +9665XXXXXXXX" }, 400);
              }
              body.supportWhatsapp = normalizedWhatsapp;
            }
            const allowedSettings = [
              "bannerImageUrl",
              "bannerEnabled",
              "supportEmail",
              "supportWhatsapp",
              "deliveryPricing",
              "defaultLanguage",
              "subscriptionWarningDays",
              "notifyOnNewUser",
              "notifyOnNewProvider",
              "notifyOnNewDriver",
              "notifyOnCrVerification",
              "notifyOnFreelanceRequest",
              "providerSubscription",
              "driverSubscription"
            ];
            const fields = {};
            for (const key of allowedSettings) {
              if (key in body) fields[key] = body[key];
            }
            if (Object.keys(fields).length === 0) {
              return jsonResponse({ error: "No valid settings fields" }, 400);
            }
            await updateFirestoreDocument("app_settings", "main", fields, accessToken);
            return jsonResponse({ success: true, updated: Object.keys(fields) });
          }
          if (path === "/admin/api/upload-banner" && request.method === "POST") {
            try {
              const body = await request.json();
              if (!body.image) {
                return jsonResponse({ error: "No image data provided" }, 400);
              }
              const result = await uploadToCloudinary(body.image, "tabbakheen/banners", env);
              await updateFirestoreDocument("app_settings", "main", {
                bannerImageUrl: result.secure_url
              }, accessToken);
              return jsonResponse({ success: true, url: result.secure_url });
            } catch (e) {
              console.error("[Admin] Banner upload error:", e);
              return jsonResponse({ error: e.message || "Upload failed" }, 500);
            }
          }
          if (path === "/admin/api/change-password" && request.method === "POST") {
            try {
              const body = await request.json();
              if (!body.currentPassword || !body.newPassword) {
                return jsonResponse({ error: "Current and new password required" }, 400);
              }
              const validPw = await verifyAdminPassword(body.currentPassword, env, accessToken);
              if (!validPw) {
                return jsonResponse({ error: "Current password is incorrect" }, 401);
              }
              const newHash = await hashPassword(body.newPassword);
              await updateFirestoreDocument("app_config", "admin", {
                passwordHash: newHash,
                updatedAt: (/* @__PURE__ */ new Date()).toISOString()
              }, accessToken);
              return jsonResponse({ success: true });
            } catch (e) {
              return jsonResponse({ error: e.message || "Failed" }, 500);
            }
          }
          if (path === "/admin/api/invoices" && request.method === "GET") {
            const invoices = await listAllInvoices(accessToken);
            return jsonResponse({ success: true, invoices });
          }
          if (path === "/admin/api/invoices" && request.method === "POST") {
            try {
              const invoice = await request.json();
              const invoiceId = "inv_" + Date.now();
              invoice.status = "issued";
              await createFirestoreDocument("invoices", invoiceId, invoice, accessToken);
              console.log("[Admin] Invoice created:", invoiceId);
              return jsonResponse({ success: true, invoiceId });
            } catch (e) {
              return jsonResponse({ error: e.message }, 500);
            }
          }
          const invoiceTokenMatch = path.match(/^\/admin\/api\/invoices\/([^/]+)\/token$/);
          if (invoiceTokenMatch && request.method === "GET") {
            const invoiceId = invoiceTokenMatch[1];
            const signedToken = await createSignedInvoiceToken(invoiceId, env);
            return jsonResponse({ success: true, token: signedToken });
          }
          const invoiceEmailMatch = path.match(/^\/admin\/api\/invoices\/([^/]+)\/email$/);
          if (invoiceEmailMatch && request.method === "POST") {
            try {
              const invoiceId = invoiceEmailMatch[1];
              const body = await request.json();
              const invoiceLang = body.lang || "ar";
              const invoice = await getFirestoreDoc("invoices", invoiceId, accessToken);
              if (!invoice) {
                return jsonResponse({ error: "Invoice not found" }, 404);
              }
              if (!invoice.userEmail) {
                return jsonResponse({ error: "No email address for this invoice recipient" }, 400);
              }
              const isAr = invoiceLang === "ar";
              const subject = isAr ? "\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0634\u062A\u0631\u0627\u0643 - \u0637\u0628\u0627\u062E\u064A\u0646 #" + (invoice.invoiceNumber || invoiceId) : "Subscription Invoice - Tabbakheen #" + (invoice.invoiceNumber || invoiceId);
              const emailHtml = generateInvoiceEmailHTML(invoice, invoiceLang);
              const result = await sendEmail(invoice.userEmail, subject, emailHtml, env);
              if (result.sent) {
                await updateFirestoreDocument("invoices", invoiceId, {
                  emailSentAt: (/* @__PURE__ */ new Date()).toISOString(),
                  emailSentTo: invoice.userEmail
                }, accessToken);
              }
              return jsonResponse({ success: result.sent, emailId: result.id, reason: result.reason });
            } catch (e) {
              return jsonResponse({ error: e.message }, 500);
            }
          }
          if (path === "/admin/api/send-reminder" && request.method === "POST") {
            try {
              const body = await request.json();
              const uid = body.uid;
              if (!uid) return jsonResponse({ error: "Missing uid" }, 400);
              const user = await getFirestoreDoc("users", uid, accessToken);
              if (!user) return jsonResponse({ error: "User not found" }, 404);
              const endDate = user.subscriptionEndsAt || user.trialEndsAt;
              const daysLeft = endDate ? Math.ceil((new Date(endDate) - Date.now()) / (1e3 * 60 * 60 * 24)) : 0;
              const name = user.displayName || "";
              const pushToken = user.expoPushToken;
              if (pushToken && isExpoPushToken(pushToken)) {
                await sendExpoPush([{
                  to: pushToken,
                  title: "\u062A\u0646\u0628\u064A\u0647 \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",
                  body: "\u0647\u0644\u0627 " + name + "\n\u0627\u0634\u062A\u0631\u0627\u0643\u0643 \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0637\u0628\u0627\u062E\u064A\u0646 \u0628\u064A\u0646\u062A\u0647\u064A \u0628\u0639\u062F " + daysLeft + " \u0623\u064A\u0627\u0645",
                  data: { type: "subscription_reminder" },
                  sound: "default"
                }]);
              }
              if (user.email) {
                const emailHtml = '<div dir="rtl" style="font-family:sans-serif;padding:20px;max-width:500px;margin:0 auto"><h2 style="color:#e8722a">\u062A\u0646\u0628\u064A\u0647 \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643</h2><p>\u0647\u0644\u0627 ' + name + "</p><p>\u0627\u0634\u062A\u0631\u0627\u0643\u0643 \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0637\u0628\u0627\u062E\u064A\u0646 \u0628\u064A\u0646\u062A\u0647\u064A \u0628\u0639\u062F <strong>" + daysLeft + '</strong> \u0623\u064A\u0627\u0645.</p><p>\u062C\u062F\u062F \u0627\u0634\u062A\u0631\u0627\u0643\u0643 \u062D\u062A\u0649 \u064A\u0633\u062A\u0645\u0631 \u0638\u0647\u0648\u0631 \u062D\u0633\u0627\u0628\u0643 \u0648\u0627\u0633\u062A\u0642\u0628\u0627\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A / \u0627\u0644\u062A\u0648\u0635\u064A\u0644\u0627\u062A.</p><p style="margin-top:20px;color:#666">\u0641\u0631\u064A\u0642 \u0637\u0628\u0627\u062E\u064A\u0646</p></div>';
                await sendEmail(user.email, "\u062A\u0646\u0628\u064A\u0647 \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643", emailHtml, env);
              }
              return jsonResponse({ success: true, push: !!pushToken, email: !!user.email });
            } catch (e) {
              return jsonResponse({ error: e.message }, 500);
            }
          }
          if (path === "/admin/api/send-completion-email" && request.method === "POST") {
            try {
              const body = await request.json();
              const { orderId } = body;
              if (!orderId) return jsonResponse({ error: "Missing orderId" }, 400);
              const order = await getFirestoreDoc("orders", orderId, accessToken);
              if (!order) return jsonResponse({ error: "Order not found" }, 404);
              const customer = await getFirestoreDoc("users", order.customerUid, accessToken);
              if (!customer || !customer.email) return jsonResponse({ error: "Customer email not found" }, 404);
              const provider = order.providerUid ? await getFirestoreDoc("users", order.providerUid, accessToken) : null;
              const driver = order.driverUid ? await getFirestoreDoc("users", order.driverUid, accessToken) : null;
              const customerName = customer.displayName || "";
              const providerName = provider ? provider.displayName || "" : "";
              const driverName = driver ? driver.displayName || "" : "";
              let emailBody = '<div dir="rtl" style="font-family:sans-serif;padding:20px;max-width:500px;margin:0 auto;background:#fff"><div style="text-align:center;margin-bottom:20px"><h1 style="color:#e8722a;font-size:24px">\u0637\u0628\u0627\u062E\u064A\u0646</h1></div><h2 style="color:#333">\u0637\u0644\u0628\u0643 \u0648\u0635\u0644 \u0628\u0627\u0644\u0639\u0627\u0641\u064A\u0629 \u{1F60B}</h2><p>\u0628\u0627\u0644\u0639\u0627\u0641\u064A\u0629 \u0639\u0644\u064A\u0643 ' + customerName + " \u{1F31F}</p><p>\u0637\u0644\u0628\u0643 \u0645\u0646 \u0637\u0628\u0627\u062E\u0646\u0627 \u0627\u0644\u0645\u0645\u064A\u0632<br><strong>" + providerName + "</strong></p><p>\u062A\u0645 \u062A\u062D\u0636\u064A\u0631\u0647 \u0628\u0643\u0644 \u062D\u0628 \u0648\u0639\u0646\u0627\u064A\u0629.</p>";
              if (driverName) {
                emailBody += "<p>\u0648\u0648\u0635\u0644 \u0644\u0643 \u0639\u0646 \u0637\u0631\u064A\u0642 \u0645\u0646\u062F\u0648\u0628\u0646\u0627<br><strong>" + driverName + "</strong></p>";
              }
              emailBody += '<p style="margin-top:20px">\u0646\u062A\u0645\u0646\u0649 \u0644\u0643 \u062A\u062C\u0631\u0628\u0629 \u0645\u0645\u064A\u0632\u0629! \u0644\u0627 \u062A\u0646\u0633\u0649 \u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u0637\u0644\u0628 \u0644\u062A\u0633\u0627\u0639\u062F\u0646\u0627 \u0646\u0642\u062F\u0645 \u0644\u0643 \u0627\u0644\u0623\u0641\u0636\u0644 \u062F\u0627\u0626\u0645\u0627\u064B \u{1F64F}</p><div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;text-align:center;color:#888;font-size:12px"><p>\u0641\u0631\u064A\u0642 \u0637\u0628\u0627\u062E\u064A\u0646</p></div></div>';
              const emailResult = await sendEmail(
                customer.email,
                "\u0637\u0644\u0628\u0643 \u0648\u0635\u0644 \u0628\u0627\u0644\u0639\u0627\u0641\u064A\u0629 \u{1F60B}",
                emailBody,
                env
              );
              return jsonResponse({ success: true, emailSent: emailResult.sent });
            } catch (e) {
              return jsonResponse({ error: e.message }, 500);
            }
          }
          if (path === "/admin/api/broadcast-notifications/history" && request.method === "GET") {
            try {
              const histUrl = FIRESTORE_BASE + "/admin_broadcast_notifications?pageSize=50";
              const histResp = await fetch(histUrl, { headers: { "Authorization": "Bearer " + accessToken } });
              let history = [];
              if (histResp.ok) {
                const histData = await histResp.json();
                if (histData.documents) {
                  history = histData.documents.map((doc) => parseFirestoreDoc(doc)).filter(Boolean);
                  history.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
                }
              } else {
                const errText = await histResp.text();
                console.error("[Admin] History Firestore error:", histResp.status, errText);
                return jsonResponse({ error: "History fetch failed: " + histResp.status }, 500);
              }
              return jsonResponse({ success: true, history });
            } catch (e) {
              return jsonResponse({ error: e.message }, 500);
            }
          }
          if (path === "/admin/api/broadcast-notifications/send" && request.method === "POST") {
            try {
              const body = await request.json();
              const { title, message, audience, sourceNotificationId, resendType } = body;
              if (!title || !message || !audience) {
                return jsonResponse({ error: "title, message, and audience are required" }, 400);
              }
              const validAudiences = ["customer", "provider", "driver", "all"];
              if (!validAudiences.includes(audience)) {
                return jsonResponse({ error: "Invalid audience. Must be customer, provider, driver, or all" }, 400);
              }
              const rolesToQuery = audience === "all" ? ["customer", "provider", "driver"] : [audience];
              let allMatchedUsers = [];
              for (const role of rolesToQuery) {
                const users = await queryFirestore("users", "role", "EQUAL", role, accessToken);
                allMatchedUsers = allMatchedUsers.concat(users || []);
              }
              const totalUsersMatched = allMatchedUsers.length;
              const delivery = await sendAdminBroadcast(allMatchedUsers, title, message, accessToken);
              const now = (/* @__PURE__ */ new Date()).toISOString();
              const histId = "broadcast_" + Date.now();
              const histFields = {
                title,
                message,
                audience,
                totalUsersMatched,
                ...delivery,
                createdAt: now,
                createdBy: "admin"
              };
              if (sourceNotificationId) {
                histFields.sourceNotificationId = sourceNotificationId;
                histFields.resendType = resendType || "edited";
              }
              await createFirestoreDocument("admin_broadcast_notifications", histId, histFields, accessToken);
              return jsonResponse({ success: true, totalUsersMatched, ...delivery });
            } catch (e) {
              console.error("[Admin] Broadcast send error:", e);
              return jsonResponse({ error: e.message || "Failed to send broadcast" }, 500);
            }
          }
          const bcDeleteMatch = path.match(/^\/admin\/api\/broadcast-notifications\/([^\/]+)$/);
          if (bcDeleteMatch && request.method === "DELETE") {
            try {
              const notifId = bcDeleteMatch[1];
              if (!notifId) return jsonResponse({ error: "Missing notification id" }, 400);
              await deleteFirestoreDocument("admin_broadcast_notifications", notifId, accessToken);
              return jsonResponse({ success: true });
            } catch (e) {
              console.error("[Admin] Delete notification error:", e);
              return jsonResponse({ error: e.message || "Failed to delete" }, 500);
            }
          }
          const bcResendMatch = path.match(/^\/admin\/api\/broadcast-notifications\/([^\/]+)\/resend$/);
          if (bcResendMatch && request.method === "POST") {
            try {
              const notifId = bcResendMatch[1];
              const original = await getFirestoreDoc("admin_broadcast_notifications", notifId, accessToken);
              if (!original) return jsonResponse({ error: "Notification record not found" }, 404);
              const { title, message, audience } = original;
              if (!title || !message || !audience) return jsonResponse({ error: "Original record missing required fields" }, 400);
              const validAudiences = ["customer", "provider", "driver", "all"];
              if (!validAudiences.includes(audience)) return jsonResponse({ error: "Invalid audience in original record" }, 400);
              const rolesToQuery = audience === "all" ? ["customer", "provider", "driver"] : [audience];
              let allMatchedUsers = [];
              for (const role of rolesToQuery) {
                const users = await queryFirestore("users", "role", "EQUAL", role, accessToken);
                allMatchedUsers = allMatchedUsers.concat(users || []);
              }
              const totalUsersMatched = allMatchedUsers.length;
              const delivery = await sendAdminBroadcast(allMatchedUsers, title, message, accessToken);
              const now = (/* @__PURE__ */ new Date()).toISOString();
              const newHistId = "broadcast_" + Date.now();
              await createFirestoreDocument("admin_broadcast_notifications", newHistId, {
                title,
                message,
                audience,
                totalUsersMatched,
                ...delivery,
                createdAt: now,
                createdBy: "admin",
                sourceNotificationId: notifId,
                resendType: "resend"
              }, accessToken);
              return jsonResponse({ success: true, totalUsersMatched, ...delivery });
            } catch (e) {
              console.error("[Admin] Resend notification error:", e);
              return jsonResponse({ error: e.message || "Failed to resend" }, 500);
            }
          }
          return jsonResponse({ error: "Admin endpoint not found" }, 404);
        } catch (e) {
          console.error("[Admin] API error:", e);
          return jsonResponse({ error: e.message || "Internal error" }, 500);
        }
      }
      const apiKey = request.headers.get("x-api-key");
      const hasServiceKey = !!apiKey && !!env.API_KEY && apiKey === env.API_KEY;
      let callerUid = "";
      if (!hasServiceKey) {
        try {
          callerUid = await verifyFirebaseIdToken(getTokenFromRequest(request));
        } catch (e) {
          console.log("[Auth] Rejected app request:", e && e.message ? e.message : e);
          return Response.json({ success: false, error: "Unauthorized" }, { status: 401, headers: { "Access-Control-Allow-Origin": "*" } });
        }
      }
      if (path === "/verify-cr" && request.method === "POST") {
        try {
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          return await handleVerifyCr(request, env, accessToken);
        } catch (e) {
          console.error("[Wathq] Verify CR error:", e && e.message ? e.message : e);
          return jsonResponse({ success: false, verificationStatus: "pending_review", error: "Internal error" }, 500);
        }
      }
      if (path === "/submit-freelance-cert" && request.method === "POST") {
        try {
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          return await handleSubmitFreelanceCert(request, env, accessToken);
        } catch (e) {
          console.error("[Freelance] Submit cert error:", e && e.message ? e.message : e);
          return jsonResponse({ success: false, error: "Internal error" }, 500);
        }
      }
      if (path === "/notify" && request.method === "POST") {
        try {
          const body = await request.json();
          const { event, orderId } = body;
          if (!event || !orderId) {
            return Response.json({ success: false, error: "Missing event or orderId" }, { status: 400 });
          }
          console.log("[Worker] Processing event: " + event + " for order: " + orderId);
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          if (!hasServiceKey) {
            const authOrder = await getFirestoreDoc("orders", orderId, accessToken);
            if (!authOrder) {
              return Response.json({ success: false, error: "Order not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
            }
            if (callerUid !== authOrder.customerUid && callerUid !== authOrder.providerUid && callerUid !== authOrder.driverUid) {
              console.log("[Worker] Forbidden: caller is not a party to order " + orderId);
              return Response.json({ success: false, error: "Forbidden" }, { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
            }
          }
          const result = await handleEvent(event, orderId, accessToken);
          return Response.json(result, { headers: { "Access-Control-Allow-Origin": "*" } });
        } catch (e) {
          console.error("[Worker] Error:", e);
          return Response.json({ success: false, error: e.message || "Internal error" }, {
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      if (path === "/aggregate-rating" && request.method === "POST") {
        try {
          const body = await request.json();
          const { type, uid } = body;
          if (!type || !uid || !["provider", "driver"].includes(type)) {
            return Response.json({ success: false, error: "Missing or invalid type/uid" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const collectionPath = type === "provider" ? "provider_ratings" : "driver_ratings";
          const ratingsUrl = FIRESTORE_BASE + "/" + collectionPath + "/" + uid + "/ratings";
          const ratingsResponse = await fetch(ratingsUrl, {
            headers: { "Authorization": "Bearer " + accessToken }
          });
          let ratings = [];
          if (ratingsResponse.ok) {
            const ratingsData = await ratingsResponse.json();
            if (ratingsData.documents) {
              ratings = ratingsData.documents.map((doc) => parseFirestoreDoc(doc)).filter(Boolean);
            }
          }
          const count = ratings.length;
          const avg = count > 0 ? ratings.reduce((sum, r) => sum + (r.stars || 0), 0) / count : 0;
          const roundedAvg = Math.round(avg * 10) / 10;
          const updateUrl = FIRESTORE_BASE + "/users/" + uid + "?updateMask.fieldPaths=ratingAverage&updateMask.fieldPaths=ratingCount";
          const updateResponse = await fetch(updateUrl, {
            method: "PATCH",
            headers: {
              "Authorization": "Bearer " + accessToken,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              fields: {
                ratingAverage: { doubleValue: roundedAvg },
                ratingCount: { integerValue: String(count) }
              }
            })
          });
          if (!updateResponse.ok) {
            await updateResponse.text();
            return Response.json({ success: false, error: "Failed to update user rating" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          return Response.json({ success: true, ratingAverage: roundedAvg, ratingCount: count }, {
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        } catch (e) {
          return Response.json({ success: false, error: e.message || "Internal error" }, {
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      if (path === "/finalize-delivery" && request.method === "POST") {
        try {
          const body = await request.json();
          const { orderId, method } = body;
          if (!orderId || !method || !["self_pickup", "driver"].includes(method)) {
            return Response.json({ success: false, error: "Missing or invalid orderId/method" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          console.log("[Worker] Finalize delivery: orderId=" + orderId + " method=" + method);
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const order = await getFirestoreDoc("orders", orderId, accessToken);
          if (!order) {
            return Response.json({ success: false, error: "Order not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          if (method === "self_pickup") {
            const fields2 = {
              deliveryMethod: "self_pickup",
              deliveryStatus: "self_pickup_selected",
              deliveryFee: 0,
              totalAmount: order.priceSnapshot || 0,
              deliveryDistanceKm: 0,
              deliveryPricingVersion: "v1"
            };
            await updateFirestoreDocument("orders", orderId, fields2, accessToken);
            console.log("[Worker] Self pickup finalized for order:", orderId);
            await handleEvent("self_pickup_selected", orderId, accessToken);
            return Response.json({ success: true, deliveryFee: 0, totalAmount: fields2.totalAmount, deliveryDistanceKm: 0 }, {
              headers: { "Access-Control-Allow-Origin": "*" }
            });
          }
          const providerLat = order.providerLat;
          const providerLng = order.providerLng;
          const customerLat = order.customerLat;
          const customerLng = order.customerLng;
          let pricing = { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 };
          try {
            const settings = await getFirestoreDoc("app_settings", "main", accessToken);
            if (settings && settings.deliveryPricing) {
              pricing = { ...pricing, ...settings.deliveryPricing };
            }
          } catch (e) {
            console.log("[Worker] Could not load delivery pricing, using defaults:", e.message);
          }
          let distanceKm = 0;
          let deliveryFee = pricing.baseFee || 5;
          if (providerLat && providerLng && customerLat && customerLng) {
            const R = 6371;
            const dLat = (customerLat - providerLat) * Math.PI / 180;
            const dLng = (customerLng - providerLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(providerLat * Math.PI / 180) * Math.cos(customerLat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distanceKm = R * c;
            distanceKm = Math.round(distanceKm * 10) / 10;
            const perKm = pricing.perKmInsideCity || 2;
            deliveryFee = (pricing.baseFee || 5) + distanceKm * perKm;
            deliveryFee = Math.round(deliveryFee);
            if (pricing.minFee && deliveryFee < pricing.minFee) {
              deliveryFee = pricing.minFee;
            }
            if (pricing.maxFee && deliveryFee > pricing.maxFee) {
              deliveryFee = pricing.maxFee;
            }
          }
          console.log("[Worker] Pricing: baseFee=" + pricing.baseFee + " perKm=" + pricing.perKmInsideCity + " minFee=" + pricing.minFee + " maxFee=" + pricing.maxFee + " dist=" + distanceKm + " fee=" + deliveryFee);
          const priceSnapshot = order.priceSnapshot || 0;
          const totalAmount = priceSnapshot + deliveryFee;
          const quoteId = "dq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
          const fields = {
            deliveryMethod: "driver",
            deliveryStatus: "ready_for_driver",
            deliveryFee,
            totalAmount,
            deliveryDistanceKm: distanceKm,
            deliveryQuoteId: quoteId,
            deliveryPricingVersion: "v1"
          };
          await updateFirestoreDocument("orders", orderId, fields, accessToken);
          console.log("[Worker] Driver delivery finalized: orderId=" + orderId + " fee=" + deliveryFee + " dist=" + distanceKm + "km total=" + totalAmount);
          await handleEvent("driver_delivery_requested", orderId, accessToken);
          return Response.json({
            success: true,
            deliveryFee,
            totalAmount,
            deliveryDistanceKm: distanceKm,
            deliveryQuoteId: quoteId
          }, {
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        } catch (e) {
          console.error("[Worker] Finalize delivery error:", e);
          return Response.json({ success: false, error: e.message || "Internal error" }, {
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      if (path === "/delivery-quote" && request.method === "POST") {
        try {
          const body = await request.json();
          const { orderId } = body;
          if (!orderId) {
            return Response.json({ success: false, error: "Missing orderId" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          const accessToken = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
          const order = await getFirestoreDoc("orders", orderId, accessToken);
          if (!order) {
            return Response.json({ success: false, error: "Order not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
          }
          let pricing = { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 };
          try {
            const settings = await getFirestoreDoc("app_settings", "main", accessToken);
            if (settings && settings.deliveryPricing) {
              pricing = { ...pricing, ...settings.deliveryPricing };
            }
          } catch (e) {
            console.log("[Worker] Could not load pricing for quote:", e.message);
          }
          const providerLat = order.providerLat;
          const providerLng = order.providerLng;
          const customerLat = order.customerLat;
          const customerLng = order.customerLng;
          let distanceKm = 0;
          let deliveryFee = pricing.baseFee || 5;
          if (providerLat && providerLng && customerLat && customerLng) {
            const R = 6371;
            const dLat = (customerLat - providerLat) * Math.PI / 180;
            const dLng = (customerLng - providerLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(providerLat * Math.PI / 180) * Math.cos(customerLat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distanceKm = Math.round(R * c * 10) / 10;
            const perKm = pricing.perKmInsideCity || 2;
            deliveryFee = (pricing.baseFee || 5) + distanceKm * perKm;
            deliveryFee = Math.round(deliveryFee);
            if (pricing.minFee && deliveryFee < pricing.minFee) {
              deliveryFee = pricing.minFee;
            }
            if (pricing.maxFee && deliveryFee > pricing.maxFee) {
              deliveryFee = pricing.maxFee;
            }
          }
          const priceSnapshot = order.priceSnapshot || 0;
          return Response.json({
            success: true,
            deliveryFee,
            totalAmount: priceSnapshot + deliveryFee,
            deliveryDistanceKm: distanceKm,
            subtotal: priceSnapshot
          }, {
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        } catch (e) {
          return Response.json({ success: false, error: e.message || "Internal error" }, {
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      return Response.json({ success: false, error: "Not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    __name(handleRequest, "handleRequest");
    __name2(handleRequest, "handleRequest");
  })();
})();
//# sourceMappingURL=worker.js.map
