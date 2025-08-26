# init_db.py
import sqlite3

DB_NAME = "database.db"

conn = sqlite3.connect(DB_NAME)
c = conn.cursor()

c.execute('''
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    email TEXT,
    group_name TEXT,
    event_name TEXT,
    start_date TEXT,
    start_time TEXT,
    end_date TEXT,
    end_time TEXT,
    location TEXT,
    event_type TEXT,
    participants TEXT,
    equipment TEXT,
    special_request TEXT,
    donation TEXT,
    donation_method TEXT,
    remarks TEXT,
    emergency_name TEXT,
    emergency_phone TEXT,
    status TEXT DEFAULT '待审核',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
''')

conn.commit()
conn.close()
print("✅ 数据库初始化完成（database.db 已创建 / 表 submissions 已存在）。")
