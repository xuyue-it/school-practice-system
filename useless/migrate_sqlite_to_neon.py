import sqlite3
import psycopg2
import os
from dotenv import load_dotenv

# 加载 .env 文件里的 Neon 数据库 URL
load_dotenv()
DB_URL = os.getenv("DATABASE_URL")

# 本地 SQLite 文件路径
SQLITE_PATH = r"C:\Users\lausu\Desktop\masland-seed.db"
   # 如果你的 SQLite 在别的路径，请改这里

def migrate():
    # 连接 SQLite
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_cur = sqlite_conn.cursor()

    # 读取所有数据
    sqlite_cur.execute("SELECT * FROM submissions")
    rows = sqlite_cur.fetchall()

    print(f"本地 SQLite 读取到 {len(rows)} 条数据")

    # 连接 Neon (PostgreSQL)
    pg_conn = psycopg2.connect(DB_URL)
    pg_cur = pg_conn.cursor()

    # 插入数据到 Neon
    for row in rows:
        # 注意 SQLite 和 PostgreSQL 列顺序要一致
        pg_cur.execute("""
            INSERT INTO submissions (
                id, name, phone, email, group_name, event_name,
                start_date, start_time, end_date, end_time,
                location, event_type, participants, equipment,
                special_request, donation, donation_method,
                remarks, emergency_name, emergency_phone,
                status, review_comment
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s)
            ON CONFLICT (id) DO NOTHING;
        """, row)

    pg_conn.commit()
    print("✅ 数据迁移完成！")

    sqlite_conn.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate()
