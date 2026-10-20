"""Deterministic synthetic metric geography, not a calibrated real city."""
import math

import networkx as nx
import numpy as np

VERSION = "riverton-local-v1"
WIDTH = 2400.0
HEIGHT = 2000.0
POPULATIONS = (16200, 12400, 11800, 13900, 9800, 5300, 4200, 4900)
NAMES = (
    "Downtown Waterfront", "West End Heights", "North Hills & University",
    "Eastside Flats", "Neighborhood 5 (Canal Basin)", "Southbank Industrial",
    "River Island District", "Crestview Meadows",
)


def river_center(y):
    return WIDTH / 2 + 120 * np.sin(np.asarray(y) / 400)


def elevation(x, y):
    """Smooth channel, banks and floodplain; bridge decks are NOT terrain."""
    distance = np.abs(np.asarray(x) - river_center(y))
    return -1.2 + 0.002 * np.asarray(y) + 3 * (1 - np.exp(-(distance / 160) ** 2))


def build_city():
    nodes, roads = [], []
    for j in range(5):
        for i in range(7):
            nodes.append({"id": f"v{i}-{j}", "x": 200 + i * 320, "y": 200 + j * 400})
    by_id = {v["id"]: v for v in nodes}
    for j in range(5):
        for i in range(7):
            for di, dj in ((1, 0), (0, 1)):
                if i + di > 6 or j + dj > 4:
                    continue
                a, b = by_id[f"v{i}-{j}"], by_id[f"v{i+di}-{j+dj}"]
                crossing = (a["x"] - river_center(a["y"])) * (b["x"] - river_center(b["y"])) < 0
                roads.append({
                    "id": f"r-{a['id']}-{b['id']}", "source": a["id"], "target": b["id"],
                    "geometry": [[a["x"], a["y"]], [b["x"], b["y"]]],
                    "length_m": math.hypot(a["x"]-b["x"], a["y"]-b["y"]),
                    "bridge": bool(crossing), "speed_m_s": 10.0,
                    "capacity_vehicles_s": 0.5,
                    "storage_vehicles": 0.15 * math.hypot(a["x"]-b["x"], a["y"]-b["y"]),
                    "provenance": "assumed",
                })
    neighborhoods = []
    for k, (name, population) in enumerate(zip(NAMES, POPULATIONS)):
        i, j = k % 4, k // 4
        x, y = i * 600, j * 1000
        neighborhoods.append({
            "id": f"N{k+1}", "name": name, "population": population,
            "polygon": [[x, y], [x+600, y], [x+600, y+1000], [x, y+1000], [x, y]],
            "provenance": "synthetic",
        })
    facilities = [
        {"id": "shelter-north", "node": "v3-4", "kind": "shelter", "capacity": 3500},
        {"id": "shelter-west", "node": "v0-2", "kind": "shelter", "capacity": 2800},
        {"id": "shelter-east", "node": "v6-2", "kind": "shelter", "capacity": 2200},
        {"id": "hospital-west", "node": "v0-3", "kind": "hospital", "capacity": 200},
        {"id": "depot-west", "node": "v0-1", "kind": "depot", "capacity": 10},
    ]
    for f in facilities:
        f.update(x=by_id[f["node"]]["x"], y=by_id[f["node"]]["y"], provenance="assumed")
    return {
        "version": VERSION, "coordinate_system": "synthetic local Cartesian meters",
        "vertical_datum": "arbitrary synthetic datum", "width_m": WIDTH, "height_m": HEIGHT,
        "population": sum(POPULATIONS), "nodes": nodes, "roads": roads,
        "neighborhoods": neighborhoods, "facilities": facilities,
        "calibrated": False,
        "notes": ["Synthetic metric geography shared by numerical simulation and frontend.",
                  "Population totals retained; neighborhood shapes are newly generated."],
    }


def validate_city(city):
    from shapely.geometry import Polygon, Point
    ids = [item["id"] for key in ("nodes", "roads", "neighborhoods", "facilities") for item in city[key]]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate object identifiers")
    graph = nx.Graph()
    graph.add_nodes_from(n["id"] for n in city["nodes"])
    for road in city["roads"]:
        if road["source"] not in graph or road["target"] not in graph:
            raise ValueError("road references an absent node")
        graph.add_edge(road["source"], road["target"])
    if not nx.is_connected(graph):
        raise ValueError("road network is disconnected")
    boundary = Polygon([(0, 0), (WIDTH, 0), (WIDTH, HEIGHT), (0, HEIGHT)])
    for neighborhood in city["neighborhoods"]:
        polygon = Polygon(neighborhood["polygon"])
        if not polygon.is_valid or not boundary.covers(polygon):
            raise ValueError("invalid neighborhood")
    for facility in city["facilities"]:
        if facility["node"] not in graph or not boundary.covers(Point(facility["x"], facility["y"])):
            raise ValueError("invalid facility")
    if sum(n["population"] for n in city["neighborhoods"]) != city["population"]:
        raise ValueError("population mismatch")
    return {"valid": True, "population": city["population"], "roads": len(city["roads"])}
