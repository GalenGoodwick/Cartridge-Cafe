# arena-service — Deno WebSocket authoritative multiplayer server (Railway)
FROM denoland/deno:2.1.4
WORKDIR /app
COPY server.mjs .
# cache deps (none external yet — stdlib only)
RUN deno cache server.mjs || true
EXPOSE 8080
# --allow-net: WS + bridge pulls · --allow-env: PORT/SECRET/BRIDGE_URL
CMD ["deno", "run", "--allow-net", "--allow-env", "server.mjs"]
