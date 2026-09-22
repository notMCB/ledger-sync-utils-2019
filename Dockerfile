# For hosts that run containers (Fly.io, Railway, a VPS). No dependencies beyond Python.
FROM python:3.12-slim
WORKDIR /app
COPY server ./server
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server/server.py"]
