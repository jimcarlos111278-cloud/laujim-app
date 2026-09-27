# Verifica dependencias del motor en su propio python. Sin secretos.
import importlib.util as u

for name in ['cv2', 'fastapi', 'uvicorn', 'requests', 'numpy']:
    print(name, '->', 'OK' if u.find_spec(name) else 'MISSING')
print('DEPS_DONE')
