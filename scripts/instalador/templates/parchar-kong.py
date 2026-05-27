#!/usr/bin/env python3
"""
Parcha /opt/supabase/docker/volumes/api/kong.yml agregando los paths con
prefijo /supabase/... a los services indicados en kong-paths.json.

Es idempotente: si el path ya está, lo deja como está.

Uso: python3 parchar-kong.py <ruta_kong.yml> <ruta_kong-paths.json>
"""
import sys
import json
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "ERROR: falta PyYAML. Instalalo con: sudo apt-get install -y python3-yaml\n"
    )
    sys.exit(2)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("Uso: parchar-kong.py <kong.yml> <kong-paths.json>\n")
        sys.exit(2)

    kong_yml = Path(sys.argv[1])
    paths_json = Path(sys.argv[2])

    if not kong_yml.is_file():
        sys.stderr.write(f"ERROR: no existe {kong_yml}\n")
        sys.exit(2)
    if not paths_json.is_file():
        sys.stderr.write(f"ERROR: no existe {paths_json}\n")
        sys.exit(2)

    with kong_yml.open("r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    with paths_json.open("r", encoding="utf-8") as f:
        spec = json.load(f)

    if "services" not in config or not isinstance(config["services"], list):
        sys.stderr.write("ERROR: el kong.yml no tiene una lista de 'services'.\n")
        sys.exit(2)

    services_por_nombre = {s.get("name"): s for s in config["services"]}
    modificados = []
    skipeados = []
    no_encontrados = []

    for item in spec["services_a_parchar"]:
        nombre = item["name"]
        path_extra = item["path_extra"]
        svc = services_por_nombre.get(nombre)

        if svc is None:
            no_encontrados.append(nombre)
            continue

        rutas = svc.setdefault("routes", [])
        if not rutas:
            sys.stderr.write(f"AVISO: service {nombre} no tiene routes. Skip.\n")
            continue

        # Por convención, todos los services tienen UNA ruta con una lista de paths.
        # Agregamos el path extra a la primera ruta (que es donde Kong ya tiene
        # los paths originales).
        ruta = rutas[0]
        paths_actuales = ruta.setdefault("paths", [])

        if path_extra in paths_actuales:
            skipeados.append(nombre)
        else:
            paths_actuales.append(path_extra)
            modificados.append(nombre)

    if modificados:
        # Backup antes de sobrescribir
        backup = kong_yml.with_suffix(".yml.bak-pulzar")
        if not backup.exists():
            backup.write_text(kong_yml.read_text(), encoding="utf-8")

        with kong_yml.open("w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, sort_keys=False, allow_unicode=True)

    print(json.dumps({
        "modificados": modificados,
        "skipeados": skipeados,
        "no_encontrados": no_encontrados,
        "backup": str(kong_yml.with_suffix(".yml.bak-pulzar")) if modificados else None,
    }, indent=2))


if __name__ == "__main__":
    main()
