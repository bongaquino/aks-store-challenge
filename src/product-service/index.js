const express = require("express");
const app = express();
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.listen(3002, "0.0.0.0", () => console.log("product-service on 3002"));
