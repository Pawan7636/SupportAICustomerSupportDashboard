// Quick smoke test — run with: node test-gemini.js
// Delete this file when done.
const http = require("http");

const body = JSON.stringify({
  message: "My order is late, what should I do?",
  category: "Orders",
  tone: "Concise",
});

const req = http.request(
  {
    hostname: "localhost",
    port: 3001,
    path: "/api/chat",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try {
        const json = JSON.parse(data);
        if (json.success) {
          console.log("✅ Gemini responded:\n");
          console.log(json.data.response);
        } else {
          console.error("❌ Error:", json.error);
        }
      } catch {
        console.log("Raw response:", data);
      }
    });
  }
);

req.on("error", (e) => console.error("❌ Connection error:", e.message));
req.setTimeout(30000, () => { console.error("❌ Timeout"); req.destroy(); });
req.write(body);
req.end();
