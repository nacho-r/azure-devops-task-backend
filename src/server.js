import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

const app = createApp();

app.listen(port, host, () => {
  console.log(`Azure DevOps task backend listening on http://${host}:${port}`);
});
