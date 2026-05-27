
 OVERVIEW
 ────────────────────────────────────────────
| key                | value                            |
| ---                | ---                              |
| version            | 2.0                              |
| generator          | Khronos glTF Blender I/O v5.1.19 |
| extensionsUsed     | none                             |
| extensionsRequired | none                             |



 SCENES
 ────────────────────────────────────────────
| #   | name  | rootName                               | bboxMin                  | bboxMax                | renderVertexCount¹ | uploadVertexCount | uploadNaiveVertexCount |
| --- | ---   | ---                                    | ---                      | ---                    | ---                | ---               | ---                    |
| 0   | Scene | openclinxr_canonical_humanoid_armature | -0.54814, 0.02, -0.23361 | 0.54814, 1.905, 0.2375 | 88,428             | 85,890            | 85,890                 |

¹ Expected number of vertices processed by the vertex shader for one render
  pass, without considering the vertex cache.

² Expected number of vertices uploaded to GPU, assuming each Accessor
  is uploaded only once. Actual number uploaded may be higher, 
  dependent on the implementation and vertex buffer layout.

³ Expected number of vertices uploaded to GPU, assuming each Primitive
  is uploaded once, duplicating vertex attributes shared among Primitives.



 MESHES
 ────────────────────────────────────────────
| #   | name                                      | mode      | meshPrimitives | glPrimitives | vertices | indices | attributes                                           | instances | size¹     |
| --- | ---                                       | ---       | ---            | ---          | ---      | ---     | ---                                                  | ---       | ---       |
| 0   | Sphere                                    | TRIANGLES | 1              | 528          | 1,120    | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 39.01 KB  |
| 1   | Sphere.001                                | TRIANGLES | 1              | 528          | 1,104    | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 38.5 KB   |
| 2   | Sphere.003                                | TRIANGLES | 1              | 528          | 1,106    | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 38.56 KB  |
| 3   | Cube.004                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 4   | Sphere.002                                | TRIANGLES | 1              | 528          | 1,104    | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 38.5 KB   |
| 5   | Sphere.004                                | TRIANGLES | 1              | 528          | 1,106    | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 38.56 KB  |
| 6   | Cube.005                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 7   | Cube.002                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 8   | Cube.003                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 9   | Cube.001                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 10  | neutral_generated_human_skinned_mesh_data | TRIANGLES | 3              | 26,692       | 80,062   | u16     | JOINTS_0:u8, NORMAL:f32, POSITION:f32, WEIGHTS_0:f32 | 1         | 9.45 MB   |
| 11  | Cube.006                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 12  | Cube.009                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 13  | Cube.008                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 14  | Cube.012                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 15  | Cube.011                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 16  | Cube.010                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |
| 17  | Cube.007                                  | TRIANGLES | 1              | 12           | 24       | u16     | NORMAL:f32, POSITION:f32, TEXCOORD_0:f32             | 1         | 840 Bytes |

⁴ size estimates GPU memory required by a mesh, in isolation. If accessors are
  shared by other mesh primitives, but the meshes themselves are not reused, then
  the sum of all mesh sizes will overestimate the asset's total size. See "dedup".



 MATERIALS
 ────────────────────────────────────────────
| #   | name                             | instances | textures | alphaMode | doubleSided |
| --- | ---                              | ---       | ---      | ---       | ---         |
| 0   | reviewed_local_fixture_hair      | 1         |          | OPAQUE    | ✓           |
| 1   | reviewed_local_fixture_eye_white | 2         |          | OPAQUE    | ✓           |
| 2   | reviewed_local_fixture_eye_pupil | 9         |          | OPAQUE    | ✓           |
| 3   | reviewed_local_fixture_shoes     | 3         |          | OPAQUE    | ✓           |
| 4   | reviewed_local_fixture_scrubs    | 4         |          | OPAQUE    | ✓           |
| 5   | reviewed_local_fixture_skin      | 1         |          | OPAQUE    | ✓           |



 TEXTURES
 ────────────────────────────────────────────
No textures found.


 ANIMATIONS
 ────────────────────────────────────────────
| #   | name                                            | channels | samplers | duration | keyframes | size    |
| --- | ---                                             | ---      | ---      | ---      | ---       | ---     |
| 0   | openclinxr_canonical_humanoid_armatureAction    | 51       | 51       | 4        | 102       | 1.22 KB |
| 1   | neutral_generated_human_skinned_mesh_dataAction | 1        | 1        | 4        | 96        | 1.54 KB |


