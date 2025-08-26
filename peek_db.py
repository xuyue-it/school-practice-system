# peek_db.py —— 打印当前使用的数据库路径与行数
import os, sqlite3
p = os.environ.get("DB_PATH") or os.path.expanduser(r"~\masland-data\database.db")
print("Using DB:", p)
conn = sqlite3.connect(p); c = conn.cursor()
c.execute("CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT)")
c.execute("SELECT COUNT(*) FROM submissions")
print("submissions rows:", c.fetchone()[0])
for row in c.execute("SELECT id,name,event_name,status FROM submissions ORDER BY id DESC LIMIT 5"):
    print(row)
conn.close()
