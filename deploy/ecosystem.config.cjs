module.exports = {
  apps: [
    {
      name: "ai-chat-api",
      cwd: "/opt/ai-chat-app/apps/api",
      script: "dist/server.js",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
