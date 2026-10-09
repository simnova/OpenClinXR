import base64,copy,unittest
from oracle import pack,parse,sha,validate
finish=None # Inject only the actual production helper in exercise_helper.py.
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
class FinishControls(unittest.TestCase):
 def setUp(self):
  j={'buffers':[{'byteLength':4}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':4}],'images':[{'mimeType':'image/png','bufferView':0}],'textures':[{'source':0,'sampler':0}],'samplers':[{'wrapS':10497}],'materials':[{'name':'mpfb_skin_test','normalTexture':{'index':0,'scale':1},'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'roughnessFactor':.78}},{'name':'hidden_upper','alphaMode':'MASK','alphaCutoff':.5,'pbrMetallicRoughness':{'baseColorFactor':[0,0,0,0]}}],'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':1,'targets':[{'POSITION':1}]}]}],'accessors':[{'bufferView':0},{'bufferView':0}],'nodes':[{'mesh':0,'skin':0}],'skins':[{'joints':[1]}],'animations':[{'name':'motion','channels':[]}],'scene':0,'scenes':[{'nodes':[0]}]}
  self.source=pack(j,b'base');self.recipe={'sourceSha256':sha(self.source),'materialName':'mpfb_skin_test','normal':{'sha256':sha(PNG),'conditionedOnSourceSha256':sha(self.source)}};self.candidate,self.checks=finish(self.source,self.recipe,PNG)
 def assert_valid(self,c):validate(self.source,c,'mpfb_skin_test',PNG)
 def mutate(self,fn):
  j,b=parse(self.candidate);fn(j);return pack(j,b)
 def test_positive_bound_maps_preserve_payload(self):self.assert_valid(self.candidate)
 def test_old_source_fails_same_acceptance(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.source)
 def test_geometry_mutation_rejected(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.mutate(lambda j:j['meshes'][0]['primitives'][0]['attributes'].update(POSITION=1)))
 def test_hidden_opacity_override_rejected(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.mutate(lambda j:j['materials'][1]['pbrMetallicRoughness'].update(baseColorFactor=[0,0,0,1])))
 def test_animation_mutation_rejected(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.mutate(lambda j:j['animations'][0].update(name='replaced')))
 def test_normal_strength_mutation_rejected(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.mutate(lambda j:j['materials'][0]['normalTexture'].update(scale=0)))
 def test_requested_normal_unwired_rejected(self):
  with self.assertRaises(AssertionError):self.assert_valid(self.mutate(lambda j:j['materials'][0]['normalTexture'].update(index=0)))
 def test_original_binary_mutation_rejected(self):
  j,b=parse(self.candidate)
  with self.assertRaises(AssertionError):self.assert_valid(pack(j,b'evil'+b[4:]))
 def test_wrong_source_identity_rejected(self):
  r=copy.deepcopy(self.recipe);r['sourceSha256']='0'*64
  with self.assertRaises(AssertionError):finish(self.source,r,PNG)
 def test_normal_from_other_actor_rejected(self):
  r=copy.deepcopy(self.recipe);r['normal']['conditionedOnSourceSha256']='0'*64
  with self.assertRaises(AssertionError):finish(self.source,r,PNG)
 def test_unproven_albedo_license_rejected(self):
  r=copy.deepcopy(self.recipe);r['albedo']={'sha256':sha(PNG),'license':'unknown','sourceUrl':'https://example.com','assetId':'unapproved'}
  with self.assertRaises(AssertionError):finish(self.source,r,PNG,PNG)
if __name__=='__main__':unittest.main()
