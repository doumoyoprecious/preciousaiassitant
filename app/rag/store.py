"""Vector store backed by SQLite (embeddings as float32 BLOBs) + numpy cosine search."""
import numpy as np

from .. import db
from .embed import embedder

BATCH = 64


class VectorStore:
    def add_chunks(self, doc_id: str, doc_name: str, category: str, chunks):
        """chunks: list of {content, page, section}. Embeds in batches, then stores."""
        texts = [c["content"] for c in chunks]
        if not texts:
            return 0
        vecs = []
        for i in range(0, len(texts), BATCH):
            vecs.append(embedder.embed(texts[i:i + BATCH]))
        vecs = np.vstack(vecs) if vecs else np.zeros((0, embedder.dim), dtype=np.float32)
        rows = []
        for i, c in enumerate(chunks):
            rows.append((db.new_id(), doc_id, doc_name, category, i, c.get("page"),
                         c.get("section"), c["content"], embedder.encode(vecs[i][None, :])))
        db.executemany("INSERT INTO chunks(id,doc_id,doc_name,category,idx,page,section,content,embedding) "
                       "VALUES(?,?,?,?,?,?,?,?,?)", rows)
        return len(rows)

    def delete_doc(self, doc_id: str):
        db.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))

    def search(self, query_vec, top_k: int = 4, min_score: float = 0.25, category=None):
        sql = "SELECT id,doc_id,doc_name,category,idx,page,section,content,embedding FROM chunks"
        args = ()
        if category:
            sql += " WHERE category=?"
            args = (category,)
        rows = db.query(sql, args)
        if not rows:
            return []
        mat = np.stack([embedder.decode(r["embedding"]) for r in rows])
        scores = mat @ np.asarray(query_vec, dtype=np.float32)
        order = np.argsort(-scores)[:top_k]
        out = []
        for i in order:
            s = float(scores[i])
            if s < min_score:
                continue
            r = rows[i]
            out.append({
                "chunk_id": r["id"], "doc_id": r["doc_id"], "doc_name": r["doc_name"],
                "category": r["category"], "page": r["page"], "section": r["section"],
                "content": r["content"], "score": round(s, 3),
            })
        return out

    def count(self) -> int:
        row = db.query_one("SELECT COUNT(*) AS n FROM chunks")
        return row["n"] if row else 0


store = VectorStore()
