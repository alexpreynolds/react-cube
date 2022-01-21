#!/usr/bin/env python

import numpy as np
from numpy.core.fromnumeric import compress
import umap
import h5py
import string
import random

'''
Run UMAP on some random data and package the results into a structured HDF5 container
'''

alphabet = string.ascii_lowercase + string.digits
def uid():
  return ''.join(random.choices(alphabet, k=8))

seed = 42
samples = 100
columns = 4
np.random.seed(seed)
datapoints = np.random.rand(samples, columns)

with h5py.File("data.h5", "w") as f:

  '''
  - override number of default components from 2 to 3
  '''

  fit = umap.UMAP(
    n_neighbors=15, 
    min_dist=0.1,
    n_components=3,
    metric="euclidean"
  )
  umap_results = fit.fit_transform(datapoints)

  '''
  - set up metadata: groups, labels and colors per point in a group
  - store colors as rgba values translated to uint8 (single-byte) values
  '''

  md = f.create_group("metadata")

  summary = md.create_group("summary")
  summary.attrs["title"] = "UMAP embedding of random RGBa colours"
  summary.attrs["subtitle"] = "n_neighbors=15, min_dist=0.1, metric=euclidean"
  summary.attrs["href"] = "https://umap-learn.readthedocs.io/en/latest/parameters.html"
  summary.attrs["description"] = "A 3-component UMAP embedding of uniform samples drawn at random from a 4-dimensional cube, interpreting a tuple of (R, G, B, a) values specifying color and translucency."

  axes = md.create_group("axes")
  axes_x = axes.create_group("x")
  axes_y = axes.create_group("y")
  axes_z = axes.create_group("z")
  axes_x.attrs["name"] = "X"
  axes_x.attrs["rgba_uint8"] = np.asarray([255,0,0,255], dtype=np.uint8)
  axes_y.attrs["name"] = "Y"
  axes_y.attrs["rgba_uint8"] = np.asarray([0,255,0,255], dtype=np.uint8)
  axes_z.attrs["name"] = "Z"
  axes_z.attrs["rgba_uint8"] = np.asarray([0,0,255,255], dtype=np.uint8)

  groups = md.create_group("groups")
  group_id = uid()
  group_name = "RGBa colorspace"
  group = groups.create_group(group_id)
  group.attrs["name"] = group_name

  group_ids = []
  group_ids.append(group_id)
  groups["ordered_ids"] = group_ids

  label_names = []
  rgba_uint8 = []
  f2i = lambda f : 255 if np.floor(f) >= 1.0 else f * 256.0
  for i, v in enumerate(datapoints):
    label_name = '{}-{}'.format(group_name, i)
    label_names.append(label_name.encode('utf-8'))
    rgba_uint8.append([f2i(v[0]), f2i(v[1]), f2i(v[2]), f2i(v[3])]) # RGBa
  ds_dtype = [('rgba_uint8', np.uint8, (4, )), ('name', np.character, 64)]
  ds_arr = np.recarray((samples, ), dtype=ds_dtype)
  ds_arr['rgba_uint8'] = np.asarray(rgba_uint8)
  ds_arr['name'] = np.asarray(label_names)
  labelset = group.create_dataset("labels", (samples, ), data=ds_arr, compression="gzip", compression_opts=9)

  '''
  - use u[:,i] for i-th component value (i.e., x-y-z)
  - each point has a one-to-one mapping to a color
  '''

  pi = []
  li = []
  for i, v in enumerate(umap_results):
    pi.append(v)
    li.append(i)
  ds_dtype = [('xyz', np.float32, (3, )), ('label_idx', np.uint32)]
  ds_arr = np.recarray((samples, ), dtype=ds_dtype)
  ds_arr['xyz'] = np.asarray(pi)
  ds_arr['label_idx'] = np.asarray(li)
  data = f.create_group("data")
  pointset = data.create_dataset(group_id, data=ds_arr, compression="gzip", compression_opts=9)