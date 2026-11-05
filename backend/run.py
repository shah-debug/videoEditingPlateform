"""Start the AI Caption Studio backend:  python run.py   (then open http://127.0.0.1:8000)"""
import uvicorn

from app.config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False, log_level="info")
