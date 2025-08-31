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
from dotenv import load_dotenv
import os
from functools import wraps
import psycopg2

# ========== Flask 应用 ==========
app = Flask(__name__)

# 上传文件目录
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# 限制上传文件大小（5MB）
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024

# 允许的扩展名
ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "jpg", "jpeg", "png"}
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ========== 基本配置 ==========
load_dotenv()
app.secret_key = os.getenv("SECRET_KEY", "replace-this-in-prod")

# ========== 邮件配置 ==========
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "lausukyork8@gmail.com")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD", "ejlnrpkvvwotxlzj")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "lausukyork8@gmail.com")

# ========== 数据库配置 ==========
DB_URL = os.getenv("DB_URL")
def get_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)

# ========== 初始化数据库 ==========
def init_db():
    conn = get_conn()
    c = conn.cursor()
    # 用户表
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user'
    )''')
    # 申请表
    c.execute('''CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name TEXT, phone TEXT, email TEXT, group_name TEXT, event_name TEXT,
        start_date TEXT, start_time TEXT, end_date TEXT, end_time TEXT,
        location TEXT, event_type TEXT, participants TEXT, equipment TEXT,
        special_request TEXT, donation TEXT, donation_method TEXT,
        remarks TEXT, emergency_name TEXT, emergency_phone TEXT,
        status TEXT DEFAULT '待审核', review_comment TEXT,
        attachment TEXT
    )''')
    conn.commit()
    conn.close()

init_db()

# ========== 登录/权限 ==========
def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapper

def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("user_id") or session.get("role") != "admin":
            return "无权限", 403
        return view(*args, **kwargs)
    return wrapper

# ========== 用户系统 ==========
@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        role = request.form.get("role", "user")  # 默认普通用户
        if not username or not password:
            error = "用户名和密码必填"
        else:
            conn = get_conn(); c = conn.cursor()
            try:
                c.execute("INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)",
                          (username, generate_password_hash(password), role))
                conn.commit()
                conn.close()
                return redirect(url_for("login"))
            except Exception as e:
                conn.rollback(); conn.close()
                error = f"注册失败: {e}"
    return render_template("register.html", error=error)

@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT id, username, password_hash, role FROM users WHERE username=%s", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row[2], password):
            session["user_id"] = row[0]
            session["username"] = row[1]
            session["role"] = row[3]
            return redirect(request.args.get("next") or url_for("index"))
        else:
            error = "用户名或密码错误"
    return render_template("login.html", error=error)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# ========== 首页 ==========
@app.route("/")
def index():
    return render_template("index.html")

# ========== 表单 ==========
@app.route("/form")
@login_required
def form_page():
    return render_template("form.html")

@app.route("/submit", methods=["POST"])
@login_required
def submit():
    data = request.form.to_dict(flat=True)

    # 附件
    files = request.files.getlist("attachments")
    filenames = []
    for file in files:
        if file and file.filename:
            if not allowed_file(file.filename):
                return f"❌ 不允许的文件类型: {file.filename}", 400
            fname = secure_filename(file.filename)
            save_path = os.path.join(app.config["UPLOAD_FOLDER"], fname)
            file.save(save_path)
            filenames.append(fname)
    filenames_str = ",".join(filenames) if filenames else None

    # 插入数据库
    conn = get_conn(); c = conn.cursor()
    c.execute('''INSERT INTO submissions (
        name, phone, email, group_name, event_name,
        start_date, start_time, end_date, end_time,
        location, event_type, participants, equipment,
        special_request, donation, donation_method,
        remarks, emergency_name, emergency_phone, attachment
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (data.get('name'), data.get('phone'), data.get('email'), data.get('group'),
         data.get('event_name'), data.get('start_date'), data.get('start_time'),
         data.get('end_date'), data.get('end_time'), data.get('location'),
         data.get('event_type'), data.get('participants'), data.get('equipment'),
         data.get('special_request'), data.get('donation'), data.get('donation_method'),
         data.get('remarks'), data.get('emergency_name'), data.get('emergency_phone'),
         filenames_str))
    conn.commit(); conn.close()

    # 发邮件通知管理员
    send_email("【新申请】通用申请",
               f"申请人：{data.get('name')}\n活动：{data.get('event_name')}\n电话：{data.get('phone')}\n邮箱：{data.get('email')}",
               ADMIN_EMAIL)

    return "<h1>提交成功！</h1><p>请返回首页查询审核状态。</p>"

# ========== 其余原本的功能 (admin, stats, status, update, delete, download 等) ==========
# ⚠️ 全部保持原样，只在 admin/stats 上加 @admin_required 即可
# （我省略重复贴代码，你直接把你原有的那部分粘回这里）

# ========== 启动 ==========
if __name__ == "__main__":
    app.run(debug=True)
