#!/usr/bin/env python

import numpy as np
import umap
import json
from collections import OrderedDict
import gzip
import string
import random

alphabet = string.ascii_lowercase + string.digits
def uid():
  return ''.join(random.choices(alphabet, k=8))

seed = 42
points = 1000
columns = 4
np.random.seed(seed)
data = np.random.rand(points, columns)

'''
- override number of default components from 2 to 3
'''

fit = umap.UMAP(n_components=3)
u = fit.fit_transform(data)

'''
- set up metadata
'''

o = {
  'metadata' : {
    'groups' : {
    }  
  },
  'data' : {
    'points' : [],
    'range' : {}
  }
}

gid = uid()
gname = 'main'
o['metadata']['groups'][gid] = { 'name': gname, 'labels': OrderedDict() }

'''
- use data as rgba() color values
- use u[:,i] for i-th component value (i.e., x-y-z)
'''

for i,v in enumerate(data):
  # prevent collisions
  while True:
    lid = uid()
    if lid not in o['metadata']['groups'][gid]['labels']: break
  o['metadata']['groups'][gid]['labels'][lid] = {
    'name' : '{}-{}'.format(gname, i),
    'rgba' : 'rgba({})'.format(','.join([str(format(x, '.2f')) for x in v.tolist()])),
  }

labels = list(o['metadata']['groups'][gid]['labels'].items())
for i,v in enumerate(u):
  x = float(format(v[0].item(), '.2f'))
  y = float(format(v[1].item(), '.2f'))
  z = float(format(v[2].item(), '.2f'))
  # pull label from associated entry in metadata labels
  lid = labels[i][0]
  xyzgl = [x, y, z, gid, lid]
  o['data']['points'].append(xyzgl)

mins = [float(str(format(x, '.2f'))) for x in u.min(axis=0).tolist()]
maxs = [float(str(format(x, '.2f'))) for x in u.max(axis=0).tolist()]

o['data']['range'] = {
  'x' : {
    'min' : mins[0],
    'max' : maxs[0],
  },
  'y' : {
    'min' : mins[1],
    'max' : maxs[1],
  },
  'z' : {
    'min' : mins[2],
    'max' : maxs[2],
  }
}

j = json.dumps(o) + '\n'
with gzip.open('data.json.gz', 'w') as ofh:
  ofh.write(j.encode('utf-8'))