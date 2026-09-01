# Matches README §15's zero-cost deploy target (Oracle Cloud Always Free /
# any container host). Build: docker build -t vaari-backend .
# Run:   docker run -p 8000:8000 --env-file .env vaari-backend
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# ponytail: SQLite file lives in the container by default — fine for a demo,
# gone on every redeploy. Set DATABASE_URL to Postgres (.env.example) for
# anything that needs to survive a restart.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
