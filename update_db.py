import sqlite3

conn = sqlite3.connect("database.db")
c = conn.cursor()

# 检查 submissions 表里有没有 status 字段，没有就加
c.execute("PRAGMA table_info(submissions)")
columns = [col[1] for col in c.fetchall()]
if "status" not in columns:
    c.execute("ALTER TABLE submissions ADD COLUMN status TEXT DEFAULT 'pending'")

conn.commit()
conn.close()
print("✅ 数据库更新完成！")
