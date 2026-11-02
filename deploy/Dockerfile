FROM python:3.12-slim
WORKDIR /app
COPY src/ /app/src/
RUN useradd -r -u 10001 tiaojietai && chown -R tiaojietai /app
USER tiaojietai
EXPOSE 8770
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8770/api/health',timeout=2)"
CMD ["python", "src/server.py", "--host", "0.0.0.0", "--port", "8770"]
