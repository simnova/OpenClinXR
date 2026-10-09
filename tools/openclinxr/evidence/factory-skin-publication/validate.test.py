import importlib.util,pathlib,unittest,copy
p=pathlib.Path(__file__).with_name('validate.py');s=importlib.util.spec_from_file_location('validator',p);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
class Controls(unittest.TestCase):
 def test_postswap_interrupted_receipt_lookup_is_truthful(self):
  p={'actualOutputSha256':'new','lookupReceiptSha256':'newreceipt','outcome':'interrupted_recoverable','receiptPrewritten':True,'bookkeepingComplete':False};v.assert_publication(p,'new','newreceipt')
  for key,value in [('actualOutputSha256','old'),('lookupReceiptSha256','oldreceipt'),('receiptPrewritten',False),('bookkeepingComplete',True)]:
   bad={**p,key:value}
   with self.assertRaises(AssertionError):v.assert_publication(bad,'new','newreceipt')
 def test_rest_allowed_pose_rejected(self):
  r={'0:0':[(0.,1.,2.),(1.,2.,3.)]};v.assert_basis(r,r)
  posed=copy.deepcopy(r);posed['0:0'][0]=(0.,1.0575,2.)
  with self.assertRaisesRegex(AssertionError,'posed'):v.assert_basis(r,posed)
 def test_actual_consumer_binding_both_directions(self):
  pixels={'width':8,'height':8,'rgbaSha256':'a'*64};u={'probe':'actual-ui-xr-loader','scenarioId':'peds_asthma_parent_anxiety_v1','actorId':'parent_tara_johnson_v1','finishedSha256':'f','networkBodySha256':'f','decoded':{'albedo':pixels,'normal':pixels},'bindings':[{'albedo':pixels,'normal':pixels}]};v.assert_ui(u,'f')
  for defect in ['body','normal','actor']:
   bad=copy.deepcopy(u)
   if defect=='body':bad['networkBodySha256']='old'
   if defect=='normal':bad['bindings'][0]['normal']={**bad['bindings'][0]['normal'],'rgbaSha256':'b'*64}
   if defect=='actor':bad['actorId']='someone_else'
   with self.assertRaises(AssertionError):v.assert_ui(bad,'f')
 def test_exact_source_receipt_both_directions(self):
  r={'sourceSha256':'source','normalSha256':'normal','conditionedOnSourceSha256':'source','finishedSha256':'finish','authoredRecipeSha256':'recipe'};v.assert_receipt(r,'source','normal','finish','recipe')
  for key in r:
   bad=dict(r);bad[key]='stale'
   with self.assertRaises(AssertionError):v.assert_receipt(bad,'source','normal','finish','recipe')
if __name__=='__main__':unittest.main()
