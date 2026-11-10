"""Unit checks for driver.check_stop. Run: python3 test_stop.py"""
import json
import driver as d
ob = json.load(open("objective.json"))
def rows(Ds, feas=1):
    return [dict(trial=i, feasible=feas, D=D, **{"D_" + v: D / 4 for v in d.VIEWS}) for i, D in enumerate(Ds)]
inc = dict(D=40, **{"D_" + v: 10 for v in d.VIEWS})
print("infeasible:", d.check_stop(rows([9] * 30, 0), None, ob, "material", 0)[0])
print("plateau   :", d.check_stop(rows([50] + [49.9] * 50), None, ob, "material", 0)[0])
print("budget    :", d.check_stop(rows([50 - i * .5 for i in range(96)]), None, ob, "material", 0)[0])
print("wall      :", d.check_stop(rows([50, 49]), None, ob, "material", 4.1 * 3600)[0])
print("ship      :", d.check_stop(rows([50, 20]), inc, ob, "material", 0)[0])
print("none      :", d.check_stop(rows([50, 49]), inc, ob, "material", 0)[0])
