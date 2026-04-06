@echo off
start "Backend" cmd /k "cd /d "C:\Users\khaled ahmed\OneDrive\Desktop\Website\academy-system\backend" && node src\app.js"
timeout /t 3 /nobreak >nul
start "Frontend" cmd /k "cd /d "C:\Users\khaled ahmed\OneDrive\Desktop\Website\academy-system\frontend" && npx serve dist -p 5173 --single"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
