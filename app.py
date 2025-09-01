from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr
import traceback
from datetime import timedelta
from dotenv import load_dotenv
import os
from functools import wraps
import psycopg2
import json
from collections import OrderedDict
import io
import pandas as pd
from docx import Document

# ========== Flask 应用 ==========
app = Flask(__name__)
app.permanent_session_lifetime = timedelta(days=365)

# 上传文件目录
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024

ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "jpg", "jpeg", "png"}
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ========== 基本配置 ==========
load_dotenv()
app.secret_key = os.getenv("SECRET_KEY", "replace-this-in-prod")

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "lausukyork8@gmail.com")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD", "ejlnrpkvvwotxlzj")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "lausukyork8@gmail.com")

DB_URL = os.getenv("DB_URL")
def get_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)

# ========== 初始化表 ==========
def init_user_table():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT DEFAULT 'user'
    )''')
    conn.commit(); conn.close()
init_user_table()

def init_form_defs():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS form_defs (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        site_name TEXT UNIQUE,
        schema_json TEXT NOT NULL,
        created_by INT REFERENCES users(id),
        db_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit(); conn.close()
init_form_defs()

# ========== 登录保护 ==========
def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_admin", next=request.path))
        return view_func(*args, **kwargs)
    return wrapper

def admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_admin", next=request.path))
        if session.get("role") not in ["admin", "super_admin"]:
            return "无权限访问", 403
        return view_func(*args, **kwargs)
    return wrapper

# ========== 管理员注册 / 登录 ==========
@app.route("/register_admin", methods=["GET", "POST"])
def register_admin():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        try:
            conn = get_conn(); c = conn.cursor()
            c.execute("INSERT INTO users (username, password_hash, role) VALUES (%s,%s,%s)",
                      (username, generate_password_hash(password), "admin"))
            conn.commit(); conn.close()
            return redirect(url_for("login_admin"))
        except Exception:
            error = "注册失败，可能用户名已存在"
    return render_template("register_admin.html", error=error)

@app.route("/login_admin", methods=["GET", "POST"])
def login_admin():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT id, password_hash, role FROM users WHERE username=%s", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row[1], password) and row[2] in ["admin", "super_admin"]:
            session.permanent = True
            session["user_id"] = row[0]
            session["username"] = username
            session["role"] = row[2]
            return redirect(url_for("super_admin" if row[2]=="super_admin" else "dashboard"))
        else:
            error = "用户名或密码错误"
    return render_template("login_admin.html", error=error)

@app.route("/dashboard")
@admin_required
def dashboard():
    return render_template("dashboard.html")

# ========== 超级管理员 ==========
@app.route("/super_admin")
@admin_required
def super_admin():
    if session.get("role") != "super_admin":
        return "❌ 只有超级管理员能访问", 403
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, site_name, db_url, created_by, created_at FROM form_defs ORDER BY id ASC")
    forms = [{"id": r[0], "name": r[1], "site_name": r[2], "db_url": r[3],
              "created_by": r[4], "created_at": r[5],
              "user_url": f"/site/{r[2]}/form", "admin_url": f"/site/{r[2]}/admin"} for r in c.fetchall()]
    c.execute("SELECT id, username, role, '平台', NOW(), '平台' FROM users ORDER BY id ASC")
    users = list(c.fetchall())
    for f in forms:
        try:
            c.execute(f"SET search_path TO {f['db_url']}")
            c.execute("SELECT id, username, role, %s, NOW(), %s FROM users", (f["site_name"], f["db_url"]))
            users += c.fetchall()
        except Exception as e: print("⚠️ 读取子用户失败:", e)
    conn.close()
    return render_template("super_admin.html", forms=forms, users=users)

# ========== 子网站管理员 ==========
@app.route("/site/<site_name>/admin")
def site_admin(site_name):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, created_by, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row: return "❌ 表单不存在", 404
    form_id, form_name, owner_id, schema_name = row
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO {schema_name}")
    c.execute("SELECT id, user_id, data, status, review_comment, created_at FROM submissions ORDER BY id DESC")
    rows = c.fetchall(); conn.close()
    field_labels = {"name":"姓名","phone":"电话","email":"邮箱","event_name":"活动名称",
                    "start_date":"开始日期","end_date":"结束日期","location":"地点","participants":"人数"}
    field_order = list(field_labels.keys())
    subs = []
    for r in rows:
        try: data = json.loads(r[2], object_pairs_hook=OrderedDict)
        except: data = {}
        subs.append((r[0], r[1], OrderedDict((f,data.get(f,"")) for f in field_order), r[3], r[4], r[5]))
    return render_template("dynamic_admin.html", form_name=form_name, submissions=subs,
                           form_id=form_id, site_name=site_name, field_order=field_order, field_labels=field_labels)

# 审核
@app.route("/form/<int:form_id>/update_status/<int:sub_id>", methods=["POST"])
def update_status(form_id, sub_id):
    data = request.get_json()
    status, comment = data.get("status"), data.get("comment")
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT db_url FROM form_defs WHERE id=%s", (form_id,))
    row = c.fetchone()
    if not row: return jsonify({"success": False, "message": "表单不存在"})
    c.execute(f"SET search_path TO {row[0]}")
    c.execute("UPDATE submissions SET status=%s, review_comment=%s WHERE id=%s", (status, comment, sub_id))
    conn.commit(); conn.close()
    return jsonify({"success": True})

# 删除提交
@app.route("/form/<int:form_id>/delete/<int:sub_id>", methods=["POST"])
def delete_submission(form_id, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT db_url FROM form_defs WHERE id=%s", (form_id,))
    row = c.fetchone()
    if not row: return jsonify({"success": False})
    c.execute(f"SET search_path TO {row[0]}")
    c.execute("DELETE FROM submissions WHERE id=%s", (sub_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

# 导出 Word
@app.route("/site/<site_name>/admin/export_word/<int:sub_id>")
def export_word(site_name, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("SELECT data FROM submissions WHERE id=%s", (sub_id,))
    row = c.fetchone(); conn.close()
    if not row: return "❌ 记录不存在", 404
    doc = Document(); doc.add_heading(f"提交 #{sub_id}", 1)
    for k,v in json.loads(row[0]).items(): doc.add_paragraph(f"{k}: {v}")
    buf = io.BytesIO(); doc.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"submission_{sub_id}.docx")

# 导出 Excel
@app.route("/site/<site_name>/admin/export_excel/<int:sub_id>")
def export_excel(site_name, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("SELECT data FROM submissions WHERE id=%s", (sub_id,))
    row = c.fetchone(); conn.close()
    if not row: return "❌ 记录不存在", 404
    df = pd.DataFrame(list(json.loads(row[0]).items()), columns=["字段","内容"])
    buf = io.BytesIO(); df.to_excel(buf,index=False); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"submission_{sub_id}.xlsx")

# ========== 健康检查 ==========
@app.route("/_health")
def _health(): return "ok", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
