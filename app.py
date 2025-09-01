from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from docx import Document
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

# ========== Flask 应用 ==========
app = Flask(__name__)

# session 永久有效（比如 365 天）
app.permanent_session_lifetime = timedelta(days=365)

# 上传文件目录
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5MB

ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "jpg", "jpeg", "png"}
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ========== 基本配置 ==========
load_dotenv()
app.secret_key = os.getenv("SECRET_KEY", "replace-this-in-prod")

# 邮件配置
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "lausukyork8@gmail.com")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD", "ejlnrpkvvwotxlzj")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "lausukyork8@gmail.com")

# 数据库配置（主库）
DB_URL = os.getenv("DB_URL")
def get_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)

# ========== 用户表初始化 ==========
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

# ========= 原有 submissions 表（固定表单） =========
def init_main_submissions():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
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
        attachment TEXT,
        status TEXT DEFAULT '待审核',
        review_comment TEXT
    )''')
    conn.commit(); conn.close()
init_main_submissions()

# ========= 动态表单定义表 =========
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

# ========== 平台入口：管理员注册/登录 ==========
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
            # ✅ 永久保持登录
            session.permanent = True
            session["user_id"] = row[0]
            session["username"] = username
            session["role"] = row[2]

            # ✅ 区分超级管理员和普通管理员
            if row[2] == "super_admin":
                return redirect(url_for("super_admin"))
            else:
                return redirect(url_for("dashboard"))
        else:
            error = "用户名或密码错误"

    return render_template("login_admin.html", error=error)

@app.route("/dashboard")
@admin_required
def dashboard():
    return render_template("dashboard.html")

# ========== 超级管理员总览（表单 + 用户） ==========
@app.route("/super_admin")
@admin_required
def super_admin():
    if session.get("role") != "super_admin":
        return "❌ 只有超级管理员能访问", 403

    conn = get_conn(); c = conn.cursor()

    # --------- 表单列表 ---------
    c.execute("SELECT id, name, site_name, db_url, created_by, created_at FROM form_defs ORDER BY id ASC")
    form_rows = c.fetchall()
    forms = [
        {
            "id": row[0],
            "name": row[1],
            "site_name": row[2],
            "db_url": row[3],
            "created_by": row[4],
            "created_at": row[5],
            "user_url": f"/site/{row[2]}/form",
            "admin_url": f"/site/{row[2]}/admin"
        }
        for row in form_rows
    ]

    # --------- 平台用户 ---------
    c.execute("SELECT id, username, role, '平台' as site_name, NOW() as created_at, '平台' as db_url FROM users ORDER BY id ASC")
    users = list(c.fetchall())

    # --------- 各子网站用户 ---------
    for form in forms:
        schema_name = form["db_url"]
        try:
            c.execute(f"SET search_path TO {schema_name}")
            c.execute("SELECT id, username, role, %s as site_name, NOW() as created_at, %s as db_url FROM users",
                      (form["site_name"], schema_name))
            users += c.fetchall()
        except Exception as e:
            print(f"⚠️ 读取 {schema_name}.users 出错:", e)

    conn.close()
    return render_template("super_admin.html", forms=forms, users=users)

# ========== 动态表单 ========== （保留唯一版本）
@app.route("/site/<site_name>/admin")
def site_admin(site_name):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, created_by, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row:
        return "❌ 表单不存在", 404

    form_id, form_name, owner_id, schema_name = row
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO {schema_name}")
    c.execute("SELECT id, user_id, data, status, review_comment, created_at FROM submissions ORDER BY id DESC")
    rows = c.fetchall(); conn.close()

    field_labels = {
        "name": "姓名","phone": "电话","email": "邮箱","group_name": "团体名称",
        "event_name": "活动名称","start_date": "开始日期","start_time": "开始时间",
        "end_date": "结束日期","end_time": "结束时间","location": "地点",
        "event_type": "性质","participants": "人数","equipment": "器材",
        "special_request": "特别需求","donation": "捐款","donation_method": "方式",
        "remarks": "备注","emergency_name": "紧急联系人","emergency_phone": "紧急电话","attachment": "附件"
    }
    field_order = list(field_labels.keys())

    submissions = []
    for r in rows:
        try:
            data_dict = r[2] if isinstance(r[2], dict) else json.loads(r[2], object_pairs_hook=OrderedDict)
        except Exception:
            data_dict = {}
        ordered_data = OrderedDict()
        for f in field_order:
            ordered_data[f] = data_dict.get(f, "")
        submissions.append((r[0], r[1], ordered_data, r[3], r[4], r[5]))

    return render_template("dynamic_admin.html",
                           form_name=form_name,
                           submissions=submissions,
                           form_id=form_id,
                           site_name=site_name,
                           field_order=field_order,
                           field_labels=field_labels)

# ========== 导出 Word ==========
# 导出 Word
@app.route("/site/<site_name>/admin/export_word/<int:sub_id>")
def export_word(site_name, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("SELECT data FROM submissions WHERE id=%s", (sub_id,))
    row = c.fetchone(); conn.close()
    if not row:
        return "❌ 记录不存在", 404

    # ✅ 兼容 dict 和 str
    if isinstance(row[0], dict):
        data = row[0]
    else:
        data = json.loads(row[0])

    doc = Document()
    doc.add_heading(f"提交 #{sub_id}", level=1)
    field_labels = {
        "name": "姓名", "phone": "电话", "email": "邮箱", "group_name": "团体名称",
        "event_name": "活动名称", "start_date": "开始日期", "start_time": "开始时间",
        "end_date": "结束日期", "end_time": "结束时间", "location": "地点",
        "event_type": "性质", "participants": "人数", "equipment": "器材",
        "special_request": "特别需求", "donation": "捐款", "donation_method": "方式",
        "remarks": "备注", "emergency_name": "紧急联系人", "emergency_phone": "紧急电话", "attachment": "附件"
    }

    for k, v in data.items():
        label = field_labels.get(k, k)  # ✅ 映射华语字段
        doc.add_paragraph(f"{label}: {v}")

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)

    return send_file(buffer, as_attachment=True,
                     download_name=f"submission_{sub_id}.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.route("/")
def index():
    return render_template("index.html")

# 导出 Excel
# 导出 Excel
@app.route("/site/<site_name>/admin/export_excel/<int:sub_id>")
def export_excel(site_name, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("SELECT data FROM submissions WHERE id=%s", (sub_id,))
    row = c.fetchone(); conn.close()
    if not row:
        return "❌ 记录不存在", 404

    # ✅ 兼容 dict 和 str
    if isinstance(row[0], dict):
        data = row[0]
    else:
        data = json.loads(row[0])

    # ✅ 在这里定义 field_labels
    field_labels = {
        "name": "姓名", "phone": "电话", "email": "邮箱", "group_name": "团体名称",
        "event_name": "活动名称", "start_date": "开始日期", "start_time": "开始时间",
        "end_date": "结束日期", "end_time": "结束时间", "location": "地点",
        "event_type": "性质", "participants": "人数", "equipment": "器材",
        "special_request": "特别需求", "donation": "捐款", "donation_method": "方式",
        "remarks": "备注", "emergency_name": "紧急联系人", "emergency_phone": "紧急电话", "attachment": "附件"
    }

    rows = []
    for k, v in data.items():
        label = field_labels.get(k, k)  # ✅ 转换为中文
        rows.append((label, v))

    df = pd.DataFrame(rows, columns=["字段", "内容"])

    buffer = io.BytesIO()
    # ✅ 强制使用 openpyxl 引擎
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"submission_{sub_id}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )



@app.route("/form/<int:form_id>/delete/<int:sub_id>", methods=["GET", "POST"])
def delete_submission(form_id, sub_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT db_url FROM form_defs WHERE id=%s", (form_id,))
    row = c.fetchone()
    if not row:
        return jsonify({"success": False, "message": "表单不存在"})
    schema_name = row[0]

    c.execute(f"SET search_path TO {schema_name}")
    c.execute("DELETE FROM submissions WHERE id=%s", (sub_id,))
    conn.commit(); conn.close()

    # 如果是 AJAX POST 请求，返回 JSON
    if request.method == "POST" and request.is_json:
        return jsonify({"success": True})
    # 如果是 GET（直接点击链接），跳回管理页
    return redirect(url_for("site_admin", site_name=schema_name.replace("form_", "")))


# ========== 健康检查 ==========
@app.route("/_health")
def _health():
    return "ok", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
