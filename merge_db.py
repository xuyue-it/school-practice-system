import os, shutil, sqlite3, datetime

# 三个数据库路径
SRC = [
    r"C:\Users\lausu\Desktop\updated_whatsapp_form\database.db",
    r"C:\Users\lausu\Desktop\updated_whatsapp_form - Copy\database.db",
]
# 与 app.py 保持一致：优先 DB_PATH，未设则用 ~\masland-data\database.db
DST = os.getenv("DB_PATH") or os.path.expanduser(r"~\masland-data\database.db")

# 提前建目录
os.makedirs(os.path.dirname(DST), exist_ok=True)

# 备份目标库
ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = DST.replace(".db", f".backup-{ts}.db")
try:
    if os.path.exists(DST):
        shutil.copy2(DST, bak)
        for ext in ("-wal", "-shm"):
            if os.path.exists(DST + ext):
                shutil.copy2(DST + ext, bak + ext)
        print("备份完成:", bak)
    else:
        print("目标库不存在，跳过备份。")
except Exception as e:
    print("备份失败但继续:", e)

# 统一表结构
DDL = '''
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
    review_comment TEXT
)
'''
def ensure_schema(dbpath):
    conn = sqlite3.connect(dbpath); c = conn.cursor()
    c.execute(DDL)
    c.execute("PRAGMA table_info(submissions)")
    cols = [r[1] for r in c.fetchall()]
    if "review_comment" not in cols:
        c.execute("ALTER TABLE submissions ADD COLUMN review_comment TEXT")
    conn.commit(); conn.close()

ensure_schema(DST)
for s in SRC:
    if os.path.exists(s): ensure_schema(s)

COLS = ["id","name","phone","email","group_name","event_name","start_date","start_time","end_date","end_time","location","event_type","participants","equipment","special_request","donation","donation_method","remarks","emergency_name","emergency_phone","status","review_comment"]

def fetch_all(dbpath):
    if not os.path.exists(dbpath): return []
    conn = sqlite3.connect(dbpath); c = conn.cursor()
    c.execute("SELECT " + ",".join(COLS) + " FROM submissions")
    rows = c.fetchall(); conn.close(); return rows

def fp_of(row):
    d = dict(zip(COLS, row))
    key = (
        (d.get("name") or "").strip().lower(),
        (d.get("phone") or "").strip(),
        (d.get("email") or "").strip().lower(),
        (d.get("event_name") or "").strip().lower(),
        (d.get("start_date") or "").strip(),
        (d.get("start_time") or "").strip(),
        (d.get("end_date") or "").strip(),
        (d.get("end_time") or "").strip(),
        (d.get("location") or "").strip().lower(),
    )
    return "|".join(key)

def insert_row(conn, row):
    d = dict(zip(COLS, row))
    cols_wo_id = [k for k in COLS if k != "id"]
    vals = [d.get(k) for k in cols_wo_id]
    conn.execute(
        f"INSERT INTO submissions ({','.join(cols_wo_id)}) VALUES ({','.join(['?']*len(vals))})",
        vals
    )

def maybe_update(conn, dst_row, src_row):
    dd = dict(zip(COLS, dst_row))
    sd = dict(zip(COLS, src_row))
    dst_status = (dd.get("status") or "").strip()
    src_status = (sd.get("status") or "").strip()
    dst_comment = (dd.get("review_comment") or "").strip()
    src_comment = (sd.get("review_comment") or "").strip()
    need, new_status, new_comment = False, dst_status, dst_comment
    if (not dst_status or "待" in dst_status) and src_status and src_status != dst_status:
        need, new_status = True, src_status
    if not dst_comment and src_comment:
        need, new_comment = True, src_comment
    if need:
        conn.execute("UPDATE submissions SET status=?, review_comment=? WHERE id=?",
                     (new_status or None, new_comment or None, dd["id"]))
    return need

dst_conn = sqlite3.connect(DST)
cur = dst_conn.cursor()
cur.execute("SELECT " + ",".join(COLS) + " FROM submissions")
dst_rows = cur.fetchall()
fp_map = {fp_of(r): r for r in dst_rows}
print("目标库现有记录：", len(dst_rows))

inserted = updated = 0
for s in SRC:
    if not os.path.exists(s):
        print("源库不存在，跳过：", s); continue
    rows = fetch_all(s)
    print("读取源库：", s, "记录数：", len(rows))
    for row in rows:
        f = fp_of(row)
        if f not in fp_map:
            insert_row(dst_conn, row); inserted += 1
        else:
            if maybe_update(dst_conn, fp_map[f], row): updated += 1

dst_conn.commit()
cur.execute("SELECT COUNT(*) FROM submissions"); total = cur.fetchone()[0]
dst_conn.close()
print(f"合并完成：插入 {inserted} 条，更新 {updated} 条。")
print("合并后总记录数：", total)
print("最终数据库：", DST)
