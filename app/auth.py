import hashlib
import secrets
import jwt
import json
import os
from datetime import datetime, timedelta
from typing import Optional

class AuthManager:
    def __init__(self, data_file: str = "/app/data/users.json"):
        self.data_file = data_file
        self.secret_key = self._get_or_create_secret()
        self.users = self._load_users()
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(data_file), exist_ok=True)

    def _get_or_create_secret(self) -> str:
        """Get or create a secret key for JWT signing"""
        secret_file = "/app/data/secret.key"
        
        try:
            with open(secret_file, 'r') as f:
                return f.read().strip()
        except FileNotFoundError:
            # Create new secret
            secret = secrets.token_urlsafe(32)
            os.makedirs(os.path.dirname(secret_file), exist_ok=True)
            with open(secret_file, 'w') as f:
                f.write(secret)
            return secret

    def _load_users(self) -> dict:
        """Load users from file"""
        try:
            with open(self.data_file, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def _save_users(self):
        """Save users to file"""
        with open(self.data_file, 'w') as f:
            json.dump(self.users, f, indent=2)

    def _hash_password(self, password: str, salt: str = None) -> tuple:
        """Hash password with salt"""
        if salt is None:
            salt = secrets.token_hex(16)
        
        # Use PBKDF2 for secure password hashing
        password_hash = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000  # 100,000 iterations
        )
        
        return password_hash.hex(), salt

    def has_users(self) -> bool:
        """Check if any users exist"""
        return len(self.users) > 0

    def create_user(self, username: str, password: str, role: str = None) -> bool:
        if username in self.users:
            raise ValueError("User already exists")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters")
        password_hash, salt = self._hash_password(password)
        # First user is always admin
        if not self.users:
            role = "admin"
        elif not role:
            role = "child"
        self.users[username] = {
            "password_hash": password_hash,
            "salt": salt,
            "created_at": datetime.utcnow().isoformat(),
            "last_login": None,
            "role": role
        }
        self._save_users()
        return True
    
    def verify_password(self, username: str, password: str) -> bool:
        """Verify user password"""
        if username not in self.users:
            return False
        
        user = self.users[username]
        password_hash, _ = self._hash_password(password, user["salt"])
        
        if password_hash == user["password_hash"]:
            # Update last login
            self.users[username]["last_login"] = datetime.utcnow().isoformat()
            self._save_users()
            return True
        
        return False

    def create_token(self, username: str) -> str:
        user = self.users.get(username)
        payload = {
            "username": username,
            "role": user.get("role", "child"),
            "exp": datetime.utcnow() + timedelta(days=7),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, self.secret_key, algorithm="HS256")

    def verify_token(self, token: str) -> Optional[dict]:
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=["HS256"])
            username = payload.get("username")
            if username in self.users:
                user = self.users[username]
                return {"username": username, "role": user.get("role", "child")}
            return None
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
        
    def change_password(self, username: str, old_password: str, new_password: str) -> bool:
        """Change user password"""
        if not self.verify_password(username, old_password):
            return False
        
        if len(new_password) < 8:
            raise ValueError("Password must be at least 8 characters")
        
        password_hash, salt = self._hash_password(new_password)
        
        self.users[username]["password_hash"] = password_hash
        self.users[username]["salt"] = salt
        
        self._save_users()
        return True

    def delete_user(self, username: str) -> bool:
        """Delete a user"""
        if username in self.users:
            del self.users[username]
            self._save_users()
            return True
        return False

    def list_users(self) -> list:
        """List all users (without sensitive data)"""
        return [
            {
                "username": username,
                "created_at": user["created_at"],
                "last_login": user["last_login"]
            }
            for username, user in self.users.items()
        ]
