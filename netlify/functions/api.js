import serverless from "serverless-http";
import app from "../../server.js";

export const handler = serverless(app, {
  request: (req, event) => {
    req.netlifyEvent = event;
  }
});
