import json
import os
import sys

def check_catalog():
    paths = ['data/cultivos.json', 'data/forestales.json']
    all_data = {}
    for p in paths:
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
                all_data.update(d)

    print(f"Total catalog entries: {len(all_data)}")

    missing_ft = 0
    missing_dens = 0
    missing_sanidad = 0

    for k, v in all_data.items():
        ft = v.get('fichaTecnica')
        if not ft:
            missing_ft += 1
            print(f"[WARNING] Missing fichaTecnica: {k}")
            continue

        secD = ft.get('seccionD_manejoSanidad', {})
        dens = secD.get('densidadRecomendada')
        san = secD.get('monitoreoSanitario')

        if dens is None or dens == "" or "no disponible" in str(dens).lower():
            missing_dens += 1
        if san is None or san == "" or "no disponible" in str(san).lower():
            missing_sanidad += 1

    print(f"Analysis complete. Entries missing density: {missing_dens}, missing sanidad: {missing_sanidad}")

if __name__ == '__main__':
    check_catalog()
