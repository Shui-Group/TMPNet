// Test script to verify layout cache POST
const graphKey = "test-graph-key-123";
const layoutVersion = "2025-11-05-fcose-v1";
const positions = [
  { id: "P12345", x: 100.5, y: 200.3 },
  { id: "Q67890", x: 150.2, y: 250.8 }
];

fetch("http://localhost:3000/api/layout-cache", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    graphKey,
    layoutVersion,
    positions,
  }),
})
  .then((res) => {
    console.log("Status:", res.status);
    return res.status === 204 ? null : res.json();
  })
  .then((data) => {
    console.log("Response:", data || "Success (204)");
  })
  .catch((err) => {
    console.error("Error:", err);
  });
