import bpy, json, sys, math
from pathlib import Path

def main():
    out=Path(sys.argv[sys.argv.index('--')+1])
    deps=bpy.context.evaluated_depsgraph_get()
    triangles=[]; parts=[]; names=[]; warnings=[]
    for instance in deps.object_instances:
        obj=instance.object
        if obj.type not in {'MESH','CURVE','SURFACE','FONT','META'} or obj.hide_render:
            continue
        if not instance.is_instance and obj.original.hide_get():
            continue
        mesh=obj.to_mesh()
        if not mesh: continue
        mesh.calc_loop_triangles()
        if not len(mesh.loop_triangles):
            obj.to_mesh_clear(); continue
        if len(triangles)//9+len(mesh.loop_triangles)>250000:
            raise ValueError('Scene exceeds 250,000 triangles. Reduce subdivision or decimate the geometry in Blender.')
        start=len(triangles)//9
        mat=instance.matrix_world
        for tri in mesh.loop_triangles:
            for idx in tri.vertices:
                p=mat @ mesh.vertices[idx].co
                # Blender Z-up -> simulation Y-up; preserve handedness.
                triangles.extend((round(p.x,7),round(p.z,7),round(-p.y,7)))
        parts.append({'start':start,'count':len(mesh.loop_triangles)})
        names.append(obj.name)
        obj.to_mesh_clear()
    if not triangles: raise ValueError('No visible mesh, curve or surface objects were found in the active scene.')
    if not all(math.isfinite(v) for v in triangles): raise ValueError('The mesh contains invalid coordinates.')
    out.write_text(json.dumps({'triangles':triangles,'parts':parts,'names':names,'warnings':warnings},separators=(',',':')))

try: main()
except Exception as e:
    print('FLOW_ERROR: '+str(e))
    raise
